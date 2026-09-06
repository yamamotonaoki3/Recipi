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

from app.config import settings
from app.errors import validation_error
from app.models.ingredient import Ingredient
from app.models.ingredient_group import IngredientGroup
from app.models.recipe import Recipe
from app.models.step import Step
from app.models.unit import Unit
from app.models.user import User
from app.schemas.recipe import (
    MAX_SEARCH_TERM_LENGTH,
    MAX_SEARCH_TERMS,
    IngredientGroupOutput,
    IngredientOutput,
    RecipeAuthor,
    RecipeListResponse,
    RecipeResponse,
    RecipeSummary,
    RecipeWriteRequest,
    RefRecipe,
    StepInput,
    StepOutput,
)
from app.text_normalize import normalize_search_text, split_search_terms


def _utcnow() -> datetime:
    return datetime.now(UTC)


def image_url(key: str | None) -> str | None:
    """オブジェクトキーから表示用 URL を組み立てる。

    Phase 3（画像アップロード / 署名付き URL）で本実装する。現時点では
    公開バケットの URL ベース（S3_PUBLIC_URL_BASE）に連結するだけ。
    キーが無ければ null（クライアントがプレースホルダを出す）。
    """
    if not key:
        return None
    return f"{settings.S3_PUBLIC_URL_BASE.rstrip('/')}/{key.lstrip('/')}"


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

    for step_pos, step_in in enumerate(_clean_steps(body.steps), start=1):
        session.add(
            Step(
                recipe_id=recipe.id,
                position=step_pos,
                body=step_in.body,
                image_key=step_in.image_key,
            )
        )


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
    _clean_steps(body.steps)  # 早期に「手順 0 件」を弾く

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
    _rebuild_children(session, recipe, body, ref_titles)
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
    ref_titles = _validate_ref_recipes(session, user, body, current_recipe_id=recipe.id)
    _clean_steps(body.steps)

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
    _rebuild_children(session, recipe, body, ref_titles)
    return recipe


def delete_recipe(session: Session, recipe: Recipe) -> None:
    """`DELETE /recipes/{id}`: レシピと関連レコードを削除する。

    - 材料グループ / 材料 / 手順 / お気に入り / 感想 / 通知は FK の CASCADE で消える。
    - このレシピを `ref_recipe_id` で参照している材料（＝投稿者本人の他レシピの
      材料）は、FK の ON DELETE SET NULL で `ref_recipe_id` だけ NULL になり、
      材料行と `ref_recipe_title`（スナップショット）は残る（features/recipe.md §3）。
    - サムネ / 手順画像のストレージ削除エンキューは Phase 3。
    """
    session.delete(recipe)


# --- レスポンス整形 ----------------------------------------------


def serialize_recipe(
    session: Session, recipe: Recipe, author: User, *, include_image_keys: bool = False
) -> RecipeResponse:
    """レシピをレスポンスへ整形する。

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
        author=RecipeAuthor(id=author.id, display_name=author.display_name),
        title=recipe.title,
        description=recipe.description,
        servings=recipe.servings,
        is_public=recipe.is_public,
        thumbnail_url=image_url(recipe.thumbnail_key),
        thumbnail_key=recipe.thumbnail_key if include_image_keys else None,
        is_favorited=False,
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
    """
    stmt = select(Recipe).where(Recipe.user_id == user.id)

    if q is not None:
        # まず空白で語に分割 → 各語を正規化（features/search.md §3 の順序）。
        # 語数 / 語長の上限超過は ValueError で返ってくるので 400 に変換する。
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
    return RecipeListResponse(
        items=[
            RecipeSummary(
                id=r.id,
                title=r.title,
                thumbnail_url=image_url(r.thumbnail_key),
                is_public=r.is_public,
                created_at=r.created_at,
            )
            for r in page
        ],
        next_cursor=_encode_cursor(page[-1]) if has_more and page else None,
    )
