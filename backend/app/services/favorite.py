"""お気に入り（♡）のドメインロジック（features/favorite.md）。

ルーター（app/api/recipes.py）は HTTP の入出力だけを担う。

## 登録 / 解除は冪等

二重に登録しても 1 行のまま、未登録の解除も成功（204）にする。モバイルは通信が
不安定で同じリクエストが 2 回届くことがあるため（processing-model.md §2「冪等」）。

## お気に入り数（`recipes.favorite_count`）を正しく増減させる工夫

フォロー（app/services/follow.py）と同じ 3 点。

1. **`recipes` 行を `FOR NO KEY UPDATE` でロックし、`favorites` への INSERT / DELETE
   より「先に」取る。** `favorites` に書くと、PostgreSQL は外部キーの整合性のため
   参照先の `recipes` 行へ自動で `FOR KEY SHARE`（共有ロック）を取る。後から
   `FOR UPDATE`（`FOR KEY SHARE` と衝突する）に上げようとすると、同じレシピを同時に
   お気に入りした全員が互いを待ってデッドロックする（Issue #66 のフォローで実際に
   起きた。lessons-learned 2026-09-10）。`FOR NO KEY UPDATE` は `FOR KEY SHARE` と
   衝突せず、同じ種類どうしだけが順番待ちになる。
2. **実際に 1 行増えた / 減ったかは `RETURNING` で判定する。** `rowcount` は ORM 経由
   では -1（不明）になることがあり、増やし忘れの事故になる。
3. **カウントは DB の中で `favorite_count = favorite_count + 1` の 1 文で更新する。**

## このモジュールは commit しない

ルーターが `run_with_retry()`（app/db.py）で包み、「実行 → commit、デッドロック等で
駄目ならロールバックしてやり直し」をまとめて行う。

## import の向き

このモジュールは app/services/recipe.py の関数（投稿者の組み立て・検索条件など）を
使う。逆向き（recipe.py → ここ）の import は作らない（循環 import になるため）。
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime

from sqlalchemy import delete, func, or_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, select

from app.errors import not_found, validation_error
from app.models.favorite import Favorite
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.recipe import RecipeFeedItem, RecipeFeedResponse
from app.services.image import image_url
from app.services.notification import create_single_notification
from app.services.recipe import apply_search_terms, author_of, lock_recipe, resolve_authors

# --- カーソル（(favorites.created_at, recipe_id) の複合） -----------------
#
# お気に入り一覧は「お気に入りした日時」の新しい順で、フィードの
# 「レシピを作った日時」とはキーが違う。取り違えないよう専用のエンコードにする
# （follow.py・history.py と同じ方針）。

_CURSOR_SEP = "|"


def _encode_cursor(created_at: datetime, recipe_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{recipe_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_at_str, id_str = raw.split(_CURSOR_SEP, 1)
        return datetime.fromisoformat(created_at_str), uuid.UUID(id_str)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        # 壊れたカーソルは 500 ではなく 400 にする（他の一覧と同じ）。
        raise validation_error("ページングカーソルが不正です") from exc


# --- 登録 / 解除 -------------------------------------------------------


def favorite(session: Session, user: User, recipe_id: uuid.UUID) -> None:
    """`user` が `recipe_id` をお気に入りに登録する（features/favorite.md §5）。

    - お気に入りできるのは公開レシピと**自分の非公開レシピ**。他人の非公開レシピと
      存在しないレシピはどちらも 404（区別すると ID の存在が漏れる）
    - すでに登録済みなら何もしない（冪等）。カウントも通知も増やさない
    - 他人のレシピなら、投稿者に `recipe_favorited` 通知を同じトランザクションで作る
    """
    # ロックは INSERT より先（モジュール冒頭の 1）。
    recipe = lock_recipe(session, recipe_id)
    if recipe is None or (not recipe.is_public and recipe.user_id != user.id):
        raise not_found("レシピが見つかりません")

    # 「まだ無ければ 1 行作る」。登録日時は DB の時計（clock_timestamp）で入れる。
    # `now()` はトランザクション開始時刻なので、同じ人が続けて登録したときに並びが
    # 同時刻になりやすい（lessons-learned 2026-09-09 #41）。
    inserted = session.execute(
        pg_insert(Favorite)
        .values(user_id=user.id, recipe_id=recipe_id, created_at=func.clock_timestamp())
        .on_conflict_do_nothing(index_elements=["user_id", "recipe_id"])
        .returning(Favorite.recipe_id)  # type: ignore[call-overload]
    ).first()
    if inserted is None:
        # 二重登録。行は 1 本のままで、カウントも通知も動かさない。
        return

    session.execute(
        update(Recipe)
        .where(Recipe.id == recipe_id)  # type: ignore[arg-type]
        .values(favorite_count=Recipe.favorite_count + 1)
    )

    # 自分のレシピを自分でお気に入りしたときは作られない（関数の中で判定する。
    # notification.md §3「自分の操作による自分あて通知は作らない」）。
    create_single_notification(
        session,
        user_id=recipe.user_id,
        type="recipe_favorited",
        actor_id=user.id,
        recipe_id=recipe_id,
    )

    # 一括 UPDATE でカウントを変えたので、メモリ上の Recipe を次のアクセスで読み直させる。
    session.expire(recipe)


def unfavorite(session: Session, user: User, recipe_id: uuid.UUID) -> None:
    """お気に入りを解除する。未登録でも、レシピが存在しなくても成功扱い（冪等・204）。

    **レシピの公開 / 非公開は問わない。** 公開中にお気に入りした他人のレシピが後から
    非公開化されても、利用者が自分のお気に入りから外せる必要があるため。
    行が実際に消えたときだけ `favorite_count` を −1 する。
    解除しても、以前の `recipe_favorited` 通知は消さない（notification.md §3）。
    """
    # 登録と同じ理由で、ロックは DELETE より先（DELETE も外部キーのために
    # 参照先へ `FOR KEY SHARE` を取るため）。
    recipe = lock_recipe(session, recipe_id)
    if recipe is None:
        # レシピが削除済みなら、ON DELETE CASCADE で行もすでに無い。
        return

    deleted = session.execute(
        delete(Favorite)
        .where(
            Favorite.user_id == user.id,  # type: ignore[arg-type]
            Favorite.recipe_id == recipe_id,  # type: ignore[arg-type]
        )
        .returning(Favorite.recipe_id),  # type: ignore[call-overload]
        execution_options={"synchronize_session": False},
    ).first()
    if deleted is None:
        # もともと登録していなかった。カウントは動かさない。
        return

    session.execute(
        update(Recipe)
        .where(Recipe.id == recipe_id)  # type: ignore[arg-type]
        .values(favorite_count=Recipe.favorite_count - 1)
    )
    session.expire(recipe)


# --- 一覧 -------------------------------------------------------------


def list_favorites(
    session: Session,
    viewer: User,
    *,
    q: str | None,
    cursor: str | None,
    limit: int,
) -> RecipeFeedResponse:
    """お気に入り一覧（`GET /users/me/favorites` と `GET /recipes?feed=favorites`）。

    2 つの API は同じ内容を返す約束（favorite.md §5）なので、この 1 関数を共有する。

    - 並びはお気に入りした日時の新しい順（同時刻は recipe_id で継ぐ）
    - **自分の非公開レシピは出す。他人のレシピで非公開化されたものは出さない**
      （`favorites` の行は残っている。公開に戻れば再び出る）。削除済みのレシピは
      CASCADE で行ごと消えている
    - `q` でタイトル + 材料名を絞り込める（フィードと同じ `apply_search_terms`）
    """
    stmt = (
        select(Recipe, Favorite.created_at)
        .join(Favorite, Favorite.recipe_id == Recipe.id)  # type: ignore[arg-type]
        .where(Favorite.user_id == viewer.id)
        .where(or_(Recipe.is_public.is_(True), Recipe.user_id == viewer.id))  # type: ignore[attr-defined, arg-type]
    )
    stmt = apply_search_terms(stmt, q)

    if cursor is not None:
        c_created, c_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Favorite.created_at < c_created)
            | ((Favorite.created_at == c_created) & (Recipe.id < c_id))
        )

    stmt = stmt.order_by(Favorite.created_at.desc(), Recipe.id.desc()).limit(limit + 1)  # type: ignore[attr-defined]
    rows = list(session.exec(stmt).all())

    # limit + 1 件取り、余分に取れたら「次ページあり」。余分の 1 件は返さない。
    has_more = len(rows) > limit
    page = rows[:limit]
    recipes = [recipe for recipe, _ in page]
    authors = resolve_authors(session, recipes)

    items = [
        RecipeFeedItem(
            id=recipe.id,
            title=recipe.title,
            thumbnail_url=image_url(recipe.thumbnail_key),
            author=author_of(authors[recipe.user_id]),
            favorite_count=recipe.favorite_count,
            # お気に入り一覧なので、閲覧者から見れば全件お気に入り済み。
            is_favorited=True,
        )
        for recipe in recipes
    ]
    next_cursor = None
    if has_more and page:
        last_recipe, last_created = page[-1]
        next_cursor = _encode_cursor(last_created, last_recipe.id)
    return RecipeFeedResponse(items=items, next_cursor=next_cursor)
