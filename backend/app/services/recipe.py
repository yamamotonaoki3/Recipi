"""レシピ CRUD のドメインロジック（features/recipe.md / unit.md）。

ルーター（app/api/recipes.py）は HTTP の入出力だけを担い、
「単一トランザクション内での全入れ替え」「単位の自動 upsert」
「refRecipeId の検証」「レスポンス整形」はここに集約する。

トランザクション境界（processing-model.md §6「レシピ POST / PUT」）:
- `recipes` ＋ `ingredient_groups` ＋ `ingredients`（全入れ替え）＋ `steps`
  （全入れ替え）＋ `units` 未登録分の ON CONFLICT upsert ＋
  `title_normalized` / `name_normalized` 生成を **1 トランザクション**で行う。
- 呼び出し側（ルーター）が `return` 前に `session.commit()` を明示する
  （app/api/auth.py 冒頭のコメント参照）。
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, delete, select

from app.errors import not_found, validation_error
from app.models.favorite import Favorite
from app.models.follow import Follow
from app.models.ingredient import Ingredient
from app.models.ingredient_group import IngredientGroup
from app.models.recipe import Recipe
from app.models.recipe_comment import RecipeComment
from app.models.step import Step
from app.models.unit import Unit
from app.models.user import User
from app.schemas.recipe import (
    MAX_SEARCH_TERM_LENGTH,
    MAX_SEARCH_TERMS,
    IngredientGroupOutput,
    IngredientOutput,
    RecipeAuthor,
    RecipeFeedItem,
    RecipeFeedResponse,
    RecipeListResponse,
    RecipeResponse,
    RecipeSummary,
    RecipeWriteRequest,
    RefRecipe,
    StepInput,
    StepOutput,
)
from app.services.image import consume_upload_keys, enqueue_object_deletion, image_url
from app.services.notification import enqueue_followee_new_recipe
from app.text_normalize import normalize_search_text, split_search_terms


def _utcnow() -> datetime:
    return datetime.now(UTC)


def author_of(user: User) -> RecipeAuthor:
    """レシピカード・詳細に載せる「投稿者」を組み立てる。

    詳細・フィード・自分のレシピ一覧・ユーザーのレシピ一覧・閲覧履歴の
    すべてで同じ形を返すため、組み立てをここ 1 か所に集める。アバターの
    URL は `users.avatar_key` から作る（無ければ null）。
    """
    return RecipeAuthor(
        id=user.id,
        display_name=user.display_name,
        avatar_url=image_url(user.avatar_key),
    )


def resolve_favorited_flags(
    session: Session, viewer: User | None, recipe_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """閲覧者がお気に入り済みのレシピ id を、まとめて 1 クエリで返す（N+1 回避）。

    一覧のカードごとに「お気に入り済みか」を問い合わせると件数ぶんクエリが飛ぶ
    ので、表示する id を全部まとめて `IN` で 1 回引く（non-functional.md）。
    未ログイン（`viewer` が None）なら何もお気に入りしていない扱いで空を返す。

    お気に入りの登録・解除（app/services/favorite.py）はこのモジュールの関数を
    使う側なので、ここから favorite.py を import しない（循環 import を作らない）。
    """
    if viewer is None or not recipe_ids:
        return set()
    rows = session.exec(
        select(Favorite.recipe_id).where(
            Favorite.user_id == viewer.id,
            Favorite.recipe_id.in_(recipe_ids),  # type: ignore[attr-defined]
        )
    ).all()
    return set(rows)


def lock_recipe(session: Session, recipe_id: uuid.UUID) -> Recipe | None:
    """レシピの行を `FOR NO KEY UPDATE` でロックして、DB の最新値で読む。

    カウント列（`favorite_count` / `comment_count`）を増減する処理が、子テーブル
    （`favorites` / `recipe_comments`）へ書き込む**前に**呼ぶ（non-functional.md
    「カウント列キャッシュのトランザクション方針」）。お気に入りと感想で共有する。

    `populate_existing` は「同じ行がセッションに読み込み済みでも、DB から読み直した
    値で上書きする」指定。同じセッションで同じ行を select し直しても古い Python
    オブジェクトが返る、という SQLAlchemy の落とし穴を避ける（lessons-learned
    2026-09-11）。公開 / 非公開の判定は、ロックを取った時点の値で行いたい。
    """
    return session.exec(
        select(Recipe)
        .where(Recipe.id == recipe_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    ).first()


# --- 単位の自動 upsert -------------------------------------------------


def upsert_units(session: Session, unit_values: list[str]) -> None:
    """材料の `unit` のうち `units` 未登録のものを自動追加する（features/unit.md §3）。

    正規化キー `normalized` で重複判定し、`INSERT ... ON CONFLICT DO NOTHING`
    で「既存なら何もしない / 新規なら 1 行足す」を 1 文で行う。
    ユーザー追加分の `placement` は常に "suffix"（前置を選ぶ手段は設けない）。
    """
    seen: dict[str, str] = {}
    for raw in unit_values:
        value = (raw or "").strip()
        if not value:
            continue
        key = normalize_search_text(value)
        # 同一リクエスト内の重複（"g" が複数材料にある等）は 1 回にまとめる。
        seen.setdefault(key, value)

    for key, value in seen.items():
        stmt = (
            pg_insert(Unit)
            .values(
                id=uuid.uuid4(),
                value=value,
                normalized=key,
                placement="suffix",
                created_at=_utcnow(),
            )
            .on_conflict_do_nothing(index_elements=["normalized"])
        )
        session.execute(stmt)


def _placement_map(session: Session, unit_values: list[str]) -> dict[str, str]:
    """正規化キー → placement の対応表を作る（レスポンス整形用）。"""
    keys = {normalize_search_text(v) for v in unit_values if v and v.strip()}
    if not keys:
        return {}
    rows = session.exec(select(Unit).where(Unit.normalized.in_(keys))).all()  # type: ignore[attr-defined]
    return {row.normalized: row.placement for row in rows}


# --- refRecipeId の検証 ----------------------------------------------


def _validate_ref_recipes(
    session: Session,
    user: User,
    body: RecipeWriteRequest,
    *,
    current_recipe_id: uuid.UUID | None,
) -> dict[uuid.UUID, str]:
    """材料の `refRecipeId` を検証し、id → 現タイトル の対応表を返す。

    指定できるのは「このレシピの投稿者本人が所有するレシピ」のみ（公開 /
    非公開問わず）。他人のレシピ・編集中のレシピ自身（自己参照）は 400
    （features/recipe.md §3）。分岐: 本人所有 / 他人・存在しない / 自己参照。
    """
    ref_ids: set[uuid.UUID] = set()
    for group in body.ingredient_groups:
        for ing in group.ingredients:
            if ing.ref_recipe_id is None:
                continue
            if current_recipe_id is not None and ing.ref_recipe_id == current_recipe_id:
                raise validation_error("編集中のレシピ自身は材料のリンク先にできません")
            ref_ids.add(ing.ref_recipe_id)

    if not ref_ids:
        return {}

    owned = session.exec(
        select(Recipe).where(Recipe.id.in_(ref_ids), Recipe.user_id == user.id)  # type: ignore[attr-defined]
    ).all()
    owned_by_id = {r.id: r.title for r in owned}

    missing = ref_ids - owned_by_id.keys()
    if missing:
        # 「他人のレシピ」「存在しない ID」を区別せず同じ 400 にする
        # （存在の有無を漏らさない。features/recipe.md §3）。
        raise validation_error("リンク先に指定できるのは自分のレシピのみです")
    return owned_by_id


# --- 手順の前処理 ---------------------------------------------------


def _clean_steps(steps: list[StepInput]) -> list[StepInput]:
    """本文が空 / 空白のみの手順行を除外する（features/recipe.md §2・§7）。

    除外後に 0 件なら 400（「手順 0 件」）。
    """
    cleaned = [StepInput(body=s.body.strip(), image_key=s.image_key) for s in steps]
    cleaned = [s for s in cleaned if s.body]
    if not cleaned:
        raise validation_error("手順を 1 つ以上入力してください")
    return cleaned


# --- 子レコードの再構築（全入れ替え） --------------------------------


def _rebuild_children(
    session: Session,
    recipe: Recipe,
    body: RecipeWriteRequest,
    ref_titles: dict[uuid.UUID, str],
    cleaned_steps: list[StepInput],
) -> None:
    """材料グループ / 材料 / 手順を、送られた配列で作り直す。

    材料グループ・材料・手順は ID を保持しない（features/recipe.md §3）。
    既存の子行を全削除してから、配列順で `position` を 1 起点の連番に振り直して
    作り直す。UNIQUE(recipe_id, position) 等に引っかからないよう、
    削除を先に flush してから INSERT する。
    """
    session.exec(delete(IngredientGroup).where(IngredientGroup.recipe_id == recipe.id))  # type: ignore[arg-type]
    session.exec(delete(Step).where(Step.recipe_id == recipe.id))  # type: ignore[arg-type]
    # ingredients は ingredient_groups の CASCADE で消えるが、明示的にも消して
    # おく（同一トランザクション内の削除順の取りこぼしを防ぐ）。
    session.exec(delete(Ingredient).where(Ingredient.recipe_id == recipe.id))  # type: ignore[arg-type]
    session.flush()

    for group_pos, group_in in enumerate(body.ingredient_groups, start=1):
        group_name = (group_in.name or "").strip() or None
        group = IngredientGroup(recipe_id=recipe.id, name=group_name, position=group_pos)
        session.add(group)
        session.flush()  # group.id を確定させる（ingredients.group_id で使う）

        for ing_pos, ing_in in enumerate(group_in.ingredients, start=1):
            ref_id = ing_in.ref_recipe_id
            ref_title = ref_titles.get(ref_id) if ref_id is not None else None
            session.add(
                Ingredient(
                    recipe_id=recipe.id,
                    group_id=group.id,
                    name=ing_in.name.strip(),
                    name_normalized=normalize_search_text(ing_in.name),
                    quantity=ing_in.quantity,
                    unit=(ing_in.unit or "").strip() or None,
                    ref_recipe_id=ref_id,
                    ref_recipe_title=ref_title,
                    position=ing_pos,
                )
            )

    for step_pos, step_in in enumerate(cleaned_steps, start=1):
        session.add(
            Step(
                recipe_id=recipe.id,
                position=step_pos,
                body=step_in.body,
                image_key=step_in.image_key,
            )
        )


# --- 画像キーの消費と削除キュー ------------------------------------
#
# 画像は「レシピ保存より前」に `POST /images` でアップロードされ、その時点では
# まだ誰からも参照されていない（`uploads.status = 'stored'`）。レシピ保存で
# 初めて本参照になるので、ここで次の 2 つをレシピ本体と**同じトランザクション**
# で行う（processing-model.md §6「レシピ POST / PUT」）:
#
#   1. 参照する側になったキーを `consumed` にする（GC に消されないように）
#   2. 参照から外れた旧キーを削除キューに積む（あとで実削除される）
#
# 同一トランザクションにするのが重要で、レシピの保存が成功したのに 1 の更新が
# 漏れると GC が使用中の画像を消してしまうし、2 が漏れると孤児が残り続ける。


def _new_image_keys(
    *,
    thumbnail_key: str | None,
    cleaned_steps: list[StepInput],
) -> list[str]:
    """保存後に参照されることになる画像キーを列挙する（重複は 400）。

    同じキーを 2 か所（例: サムネイルと手順 1）に指定すると、片方を消したときに
    もう片方がまだ使っている画像を削除キューに積んでしまう。1 キー = 1 参照を
    崩さないよう、ここで弾く。

    `cleaned_steps` は `_clean_steps` 通過後の配列を受け取る。空白だけの手順は
    保存されないため、その手順に付いたキーまで消費すると、レシピから参照されない
    画像が `consumed` のまま GC 対象外になる。
    """
    keys: list[str] = []
    if thumbnail_key:
        keys.append(thumbnail_key)
    keys.extend(s.image_key for s in cleaned_steps if s.image_key)

    seen: set[str] = set()
    for key in keys:
        if key in seen:
            raise validation_error(
                "同じ画像を複数の場所に指定することはできません",
                {"imageKey": key},
            )
        seen.add(key)
    return keys


def _existing_step_image_keys(session: Session, recipe: Recipe) -> list[str]:
    """このレシピの現在の手順画像キーを取り出す（PUT の差分計算用）。

    手順は PUT で全入れ替えされ安定 ID を持たないため、「どの画像が残り、
    どれが外れたか」は入れ替え前後のキー集合の差で判断する
    （features/image.md §3）。
    """
    steps = session.exec(select(Step).where(Step.recipe_id == recipe.id)).all()
    return [s.image_key for s in steps if s.image_key]


def _collect_unit_values(body: RecipeWriteRequest) -> list[str]:
    return [
        ing.unit
        for group in body.ingredient_groups
        for ing in group.ingredients
        if ing.unit is not None
    ]


# --- 作成 / 更新 / 削除 --------------------------------------------


def create_recipe(session: Session, user: User, body: RecipeWriteRequest) -> Recipe:
    ref_titles = _validate_ref_recipes(session, user, body, current_recipe_id=None)
    cleaned_steps = _clean_steps(body.steps)  # 早期に「手順 0 件」を弾く

    # 新規作成なので既存の参照は無い。指定された画像キーはすべて新規消費。
    consume_upload_keys(
        session,
        user,
        _new_image_keys(
            thumbnail_key=body.thumbnail_key,
            cleaned_steps=cleaned_steps,
        ),
    )

    now = _utcnow()
    recipe = Recipe(
        user_id=user.id,
        title=body.title.strip(),
        title_normalized=normalize_search_text(body.title),
        description=body.description,
        servings=body.servings,
        is_public=body.is_public,
        thumbnail_key=body.thumbnail_key,
        created_at=now,
        updated_at=now,
    )
    session.add(recipe)
    session.flush()  # recipe.id を確定

    upsert_units(session, _collect_unit_values(body))
    _rebuild_children(session, recipe, body, ref_titles, cleaned_steps)
    if recipe.is_public:
        # フォロワーへの新着通知は「配る予定」だけを同じ Tx で書く（配るのはコミット後。
        # app/services/notification.py の fan-out 節）。非公開で作ったレシピは、後で
        # 公開にしても配らない（replace_recipe では作らない）。
        enqueue_followee_new_recipe(session, recipe)
    return recipe


def replace_recipe(
    session: Session,
    user: User,
    recipe: Recipe,
    body: RecipeWriteRequest,
    *,
    update_thumbnail: bool,
) -> Recipe:
    """`PUT /recipes/{id}`: 材料グループ・材料・手順を配列で全入れ替えする。

    `update_thumbnail` が False のとき（リクエストで `thumbnailKey` 省略）は
    サムネイルを現状維持する。True のときは `body.thumbnail_key`（None = 削除）で
    上書きする（features/recipe.md §5）。
    """
    # 同じレシピへの PUT が同時に来たとき、子行を読む前に親の Recipe 行をロックする。
    # 子行（手順など）は PUT の途中で全削除して作り直すため、子行だけをロックしても
    # 「現在の画像キーを読む」という処理全体を代表できない。常に存在する親の 1 行を
    # 共通の待ち合わせ場所にすると、同じレシピの更新が順番に old_keys を読める。
    # API 層が先に取得した recipe は既にセッションのキャッシュに載っているため、
    # refresh(..., with_for_update=True) で SELECT ... FOR UPDATE と最新値の読み直しを
    # 同時に行う。単純に select し直すだけでは、古い Python オブジェクトが返りうる。
    session.refresh(recipe, with_for_update=True)

    ref_titles = _validate_ref_recipes(session, user, body, current_recipe_id=recipe.id)
    cleaned_steps = _clean_steps(body.steps)

    # --- 画像キーの差分計算（子行を作り直す前に現在の状態を控える） -------
    # サムネイルは `thumbnailKey` 省略なら現状維持なので、その場合の
    # 「保存後のサムネ」は今の値になる（features/recipe.md §5）。
    old_thumbnail_key = recipe.thumbnail_key
    old_keys = set(_existing_step_image_keys(session, recipe))
    if old_thumbnail_key:
        old_keys.add(old_thumbnail_key)

    next_thumbnail_key = body.thumbnail_key if update_thumbnail else old_thumbnail_key
    new_keys = _new_image_keys(
        thumbnail_key=next_thumbnail_key,
        cleaned_steps=cleaned_steps,
    )

    # 既にこのレシピが持っているキーの再送は「維持」なので再検証しない
    # （既に consumed なので、検証に回すと 400 になってしまう）。
    consume_upload_keys(session, user, [k for k in new_keys if k not in old_keys])

    # 逆に、今回の body に出てこなくなった旧キーは参照から外れる。
    for orphan in old_keys - set(new_keys):
        enqueue_object_deletion(session, orphan, "recipe_updated")

    recipe.title = body.title.strip()
    recipe.title_normalized = normalize_search_text(body.title)
    recipe.description = body.description
    recipe.servings = body.servings
    recipe.is_public = body.is_public
    if update_thumbnail:
        recipe.thumbnail_key = body.thumbnail_key
    recipe.updated_at = _utcnow()
    session.add(recipe)

    upsert_units(session, _collect_unit_values(body))
    _rebuild_children(session, recipe, body, ref_titles, cleaned_steps)
    return recipe


def delete_recipe(session: Session, recipe: Recipe) -> None:
    """`DELETE /recipes/{id}`: レシピと関連レコードを削除する。

    - 材料グループ / 材料 / 手順 / お気に入り / 感想 / 通知は FK の CASCADE で消える。
    - このレシピを `ref_recipe_id` で参照している材料（＝投稿者本人の他レシピの
      材料）は、FK の ON DELETE SET NULL で `ref_recipe_id` だけ NULL になり、
      材料行と `ref_recipe_title`（スナップショット）は残る（features/recipe.md §3）。
    - サムネ / 手順画像 / **感想画像**は、**CASCADE で行が消える前に**キーを集めて
      削除キューに積む。行が消えた後ではキーを取り出せないため、順序が重要
      （processing-model.md §9）。感想画像は Issue #69 で追加した。
    """
    # キーを読む前に親の Recipe 行をロックし、PUT と DELETE を同じレシピ単位で直列化する。
    # 先に古いキーを読んでからロックすると、PUT の完了を待った後に CASCADE で消える
    # 新しいキーを削除キューへ積めず、使用中の Upload がストレージに残り続けるため。
    # API 層が先に取得した recipe はセッションのキャッシュに載っているので、refresh で
    # ロック取得と最新値の読み直しを同時に行う（PUT と同じ書き方にそろえる）。
    session.refresh(recipe, with_for_update=True)

    for key in _existing_step_image_keys(session, recipe):
        enqueue_object_deletion(session, key, "recipe_deleted")
    enqueue_object_deletion(session, recipe.thumbnail_key, "recipe_deleted")

    # 感想画像。レシピ行をロックした後に読むので、同時に投稿された感想も取りこぼさない
    # （感想の投稿も同じレシピ行のロックを通るため、投稿が先ならここで見える。
    # 削除が先なら、投稿側はロック後にレシピが無いことを知って 404 になる）。
    comment_image_keys = session.exec(
        select(RecipeComment.image_key).where(
            RecipeComment.recipe_id == recipe.id,
            RecipeComment.image_key.is_not(None),  # type: ignore[union-attr]
        )
    ).all()
    for comment_key in comment_image_keys:
        enqueue_object_deletion(session, comment_key, "recipe_deleted")

    session.delete(recipe)


# --- レスポンス整形 ----------------------------------------------


def serialize_recipe(
    session: Session,
    recipe: Recipe,
    author: User,
    *,
    viewer: User | None,
    include_image_keys: bool = False,
) -> RecipeResponse:
    """レシピをレスポンスへ整形する。

    `author` はレシピの投稿者、`viewer` はこのレスポンスを受け取る閲覧者
    （未ログインなら None）。詳細を他人が見るときは 2 人が別人になる。
    `is_favorited` は閲覧者から見た状態なので `viewer` で決める。

    `include_image_keys` は「サムネ / 手順画像のオブジェクトキー」を含めるか。
    キーは編集画面が PUT で既存画像を維持するためだけに必要で、内部のストレージ
    識別子なので **投稿者本人向けのレスポンスでのみ True にする**（公開レシピを
    匿名で見た第三者には出さない。Codex #38 レビュー指摘）。"""
    groups = session.exec(
        select(IngredientGroup)
        .where(IngredientGroup.recipe_id == recipe.id)
        .order_by(IngredientGroup.position)  # type: ignore[arg-type]
    ).all()
    ingredients = session.exec(
        select(Ingredient).where(Ingredient.recipe_id == recipe.id).order_by(Ingredient.position)  # type: ignore[arg-type]
    ).all()
    steps = session.exec(
        select(Step).where(Step.recipe_id == recipe.id).order_by(Step.position)  # type: ignore[arg-type]
    ).all()

    placement_by_key = _placement_map(session, [i.unit for i in ingredients if i.unit is not None])
    # 参照先レシピがまだ存在するか（削除されると ref_recipe_id は SET NULL される）。
    ing_by_group: dict[uuid.UUID, list[Ingredient]] = {}
    for ing in ingredients:
        ing_by_group.setdefault(ing.group_id, []).append(ing)

    group_outputs: list[IngredientGroupOutput] = []
    for group in groups:
        ing_outputs: list[IngredientOutput] = []
        for ing in ing_by_group.get(group.id, []):
            ref: RefRecipe | None = None
            if ing.ref_recipe_title is not None:
                # ref_recipe_id が生きていれば {id, title}、削除済みなら {id: null, title}。
                ref = RefRecipe(id=ing.ref_recipe_id, title=ing.ref_recipe_title)
            placement = "suffix"
            if ing.unit is not None:
                placement = placement_by_key.get(normalize_search_text(ing.unit), "suffix")
            ing_outputs.append(
                IngredientOutput(
                    name=ing.name,
                    quantity=ing.quantity,
                    unit=ing.unit,
                    placement=placement,
                    ref_recipe=ref,
                )
            )
        group_outputs.append(IngredientGroupOutput(name=group.name, ingredients=ing_outputs))

    return RecipeResponse(
        id=recipe.id,
        author=author_of(author),
        title=recipe.title,
        description=recipe.description,
        servings=recipe.servings,
        is_public=recipe.is_public,
        thumbnail_url=image_url(recipe.thumbnail_key),
        thumbnail_key=recipe.thumbnail_key if include_image_keys else None,
        is_favorited=recipe.id in resolve_favorited_flags(session, viewer, [recipe.id]),
        favorite_count=recipe.favorite_count,
        comment_count=recipe.comment_count,
        ingredient_groups=group_outputs,
        steps=[
            StepOutput(
                body=s.body,
                image_url=image_url(s.image_key),
                image_key=s.image_key if include_image_keys else None,
            )
            for s in steps
        ],
        created_at=recipe.created_at,
        updated_at=recipe.updated_at,
    )


# --- 自分のレシピ一覧（カーソルページング ＋ q 検索） -------------------

_CURSOR_SEP = "|"


def _encode_cursor(recipe: Recipe) -> str:
    raw = f"{recipe.created_at.isoformat()}{_CURSOR_SEP}{recipe.id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_at_str, id_str = raw.split(_CURSOR_SEP, 1)
        return datetime.fromisoformat(created_at_str), uuid.UUID(id_str)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        # UnicodeError: 非 ASCII 文字を含むカーソル（.encode("ascii") が失敗）も
        # 500 ではなく 400 にする（Codex #37 レビュー指摘）。
        raise validation_error("ページングカーソルが不正です") from exc


def apply_search_terms(stmt, q: str | None):  # type: ignore[no-untyped-def]
    """`q`（検索窓の入力）で `stmt` に「タイトル or 材料名」の AND 絞り込みを足す。

    features/search.md §3 の手順どおり「**まず空白で語に分割** → 各語を正規化 →
    各語について title_normalized ILIKE OR 材料名 ILIKE → 語どうしは AND」。

    自分のレシピ一覧（`list_my_recipes`）とホームフィード（`list_feed`）で
    同じマッチ規則を使うので、1 か所にまとめて両方から呼ぶ。`q` が None なら
    何もしない。語数 / 語長オーバーは `split_search_terms` が `ValueError` を
    投げるので、ここで 400（`validation_error`）に変換する。
    """
    if q is None:
        return stmt

    try:
        terms = split_search_terms(
            q, max_terms=MAX_SEARCH_TERMS, max_term_length=MAX_SEARCH_TERM_LENGTH
        )
    except ValueError as exc:
        raise validation_error(str(exc)) from exc

    for term in terms:
        # 検索語に含まれる LIKE のワイルドカード（% _ \）はリテラルとして
        # 扱う。エスケープしないと `q=%` が全件ヒットするなど、部分一致の
        # 意味が崩れる（Codex #37 レビュー指摘）。
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        ingredient_match = (
            select(Ingredient.id)
            .where(
                Ingredient.recipe_id == Recipe.id,
                Ingredient.name_normalized.ilike(pattern, escape="\\"),  # type: ignore[attr-defined]
            )
            .exists()
        )
        stmt = stmt.where(
            Recipe.title_normalized.ilike(pattern, escape="\\") | ingredient_match  # type: ignore[attr-defined]
        )
    return stmt


def resolve_authors(session: Session, recipes: list[Recipe]) -> dict[uuid.UUID, User]:
    """レシピ群の投稿者を id → User の対応表で返す（N+1 回避）。

    フィード / 履歴は他人のレシピが並ぶため、各カードに投稿者名を載せる。
    レシピ 1 件ずつ `session.get(User, ...)` すると件数ぶんクエリが飛ぶので、
    user_id をまとめて 1 回の `IN` で引く（non-functional.md「N+1 を避ける」）。
    """
    user_ids = {r.user_id for r in recipes}
    if not user_ids:
        return {}
    rows = session.exec(select(User).where(User.id.in_(user_ids))).all()  # type: ignore[attr-defined]
    return {u.id: u for u in rows}


def list_my_recipes(
    session: Session,
    user: User,
    *,
    q: str | None,
    cursor: str | None,
    limit: int,
) -> RecipeListResponse:
    """自分の公開 / 非公開レシピ一覧（features/recipe.md §5「GET /users/me/recipes」）。

    `q` はタイトル + 材料名を対象に AND 検索（マッチ規則は features/search.md）。
    新着順（created_at DESC, id DESC）・カーソルページング。
    中身は「本人が自分のレシピを見る」場合の `list_recipes_by_owner` と同じ。
    """
    return list_recipes_by_owner(session, user, user.id, q=q, cursor=cursor, limit=limit)


def list_recipes_by_owner(
    session: Session,
    viewer: User,
    owner_id: uuid.UUID,
    *,
    q: str | None,
    cursor: str | None,
    limit: int,
) -> RecipeListResponse:
    """あるユーザーのレシピ一覧（features/profile.md §5「GET /users/{id}/recipes」）。

    - **本人**が見るときは非公開も含めて全部
    - **他人**が見るときは公開レシピだけ（非公開はその人だけのもの）

    存在しないユーザーは 404。並びとページングは自分のレシピ一覧と同じ。
    """
    owner = session.get(User, owner_id)
    if owner is None:
        raise not_found("ユーザーが見つかりません")

    stmt = select(Recipe).where(Recipe.user_id == owner_id)
    if owner_id != viewer.id:
        stmt = stmt.where(Recipe.is_public.is_(True))  # type: ignore[attr-defined]
    stmt = apply_search_terms(stmt, q)

    if cursor is not None:
        c_created, c_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Recipe.created_at < c_created)
            | ((Recipe.created_at == c_created) & (Recipe.id < c_id))
        )

    stmt = stmt.order_by(Recipe.created_at.desc(), Recipe.id.desc()).limit(limit + 1)  # type: ignore[attr-defined]
    rows = session.exec(stmt).all()

    has_more = len(rows) > limit
    page = rows[:limit]
    # 1 ページのレシピはすべて同じ投稿者なので、投稿者は 1 回だけ組み立てる。
    author = author_of(owner)
    favorited = resolve_favorited_flags(session, viewer, [r.id for r in page])
    return RecipeListResponse(
        items=[
            RecipeSummary(
                id=r.id,
                title=r.title,
                thumbnail_url=image_url(r.thumbnail_key),
                is_public=r.is_public,
                created_at=r.created_at,
                author=author,
                favorite_count=r.favorite_count,
                is_favorited=r.id in favorited,
            )
            for r in page
        ],
        next_cursor=_encode_cursor(page[-1]) if has_more and page else None,
    )


def list_feed(
    session: Session,
    viewer: User,
    *,
    feed: str,
    q: str | None,
    cursor: str | None,
    limit: int,
) -> RecipeFeedResponse:
    """ホームフィード（features/home-feed.md §5「GET /recipes」）。

    **公開レシピだけ**を新着順（created_at DESC, id DESC）で返す。`feed` で対象を絞る:

    | `feed` | 対象 |
    | --- | --- |
    | `all` | すべての公開レシピ |
    | `following` | 自分がフォローしている人の公開レシピ |
    | `followers` | 自分をフォローしている人の公開レシピ |

    `favorites`（お気に入りレシピ）は並びも対象も違う（お気に入りの登録日時順・
    自分の非公開も含む）ので、この関数では扱わない。`app/api/recipes.py` が
    `app/services/favorite.py` の `list_favorites` に振り分ける（この関数から
    favorite.py を呼ばないのは循環 import を作らないため）。

    `q` を渡すとタイトル + 材料名で AND 絞り込み（`list_my_recipes` と同じ
    `apply_search_terms`）で、**どの `feed` とも併用できる**（home-feed.md §3
    「表示中のサブタブの集合の中を絞り込む」）。ページングの仕組み（(created_at, id)
    の複合カーソルで同時刻レコードも重複・抜けなくたどる）も自分のレシピ一覧と共通。
    """
    stmt = select(Recipe).where(Recipe.is_public.is_(True))  # type: ignore[attr-defined]

    # フォロー / フォロワータブは「対象になる投稿者の集合」で絞る。
    # `follows` を JOIN せずサブクエリの IN にしているのは、JOIN だと
    # （将来 follows が複数行マッチする形になったとき）同じレシピが重複して
    # 並ぶ危険があるため。IN なら 1 レシピ 1 行が保証される。
    if feed == "following":
        author_ids = select(Follow.followee_id).where(Follow.follower_id == viewer.id)
        stmt = stmt.where(Recipe.user_id.in_(author_ids))  # type: ignore[attr-defined]
    elif feed == "followers":
        author_ids = select(Follow.follower_id).where(Follow.followee_id == viewer.id)
        stmt = stmt.where(Recipe.user_id.in_(author_ids))  # type: ignore[attr-defined]

    stmt = apply_search_terms(stmt, q)

    if cursor is not None:
        # カーソルは「前ページ最後の (created_at, id)」。created_at が新しいものから
        # 並べているので、「それより古い」または「同時刻ならより小さい id」を次に返す。
        c_created, c_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Recipe.created_at < c_created)
            | ((Recipe.created_at == c_created) & (Recipe.id < c_id))
        )

    stmt = stmt.order_by(Recipe.created_at.desc(), Recipe.id.desc()).limit(limit + 1)  # type: ignore[attr-defined]
    rows = session.exec(stmt).all()

    # limit + 1 件取り、余分に取れたら「次ページあり」。余分の 1 件は返さない。
    has_more = len(rows) > limit
    page = rows[:limit]
    authors = resolve_authors(session, page)
    favorited = resolve_favorited_flags(session, viewer, [r.id for r in page])
    return RecipeFeedResponse(
        items=[
            RecipeFeedItem(
                id=r.id,
                title=r.title,
                thumbnail_url=image_url(r.thumbnail_key),
                author=author_of(authors[r.user_id]),
                favorite_count=r.favorite_count,
                is_favorited=r.id in favorited,
            )
            for r in page
        ],
        next_cursor=_encode_cursor(page[-1]) if has_more and page else None,
    )
