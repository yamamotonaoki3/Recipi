"""閲覧履歴（最近見たレシピ）のドメインロジック（features/view-history.md）。

3 つの操作を担う:

- `record_view`   : レシピ詳細を開いた記録（`POST /recipes/{id}/view`）
- `list_history`  : 最近見た順の一覧（`GET /users/me/history`）
- `clear_history` : 履歴の全消去（`DELETE /users/me/history`）

ルーター（app/api/*.py）は HTTP 入出力だけを担い、可視性フィルタ・upsert・
カーソルページングはここに集約する。
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, delete, select

from app.errors import not_found, validation_error
from app.models.recipe import Recipe
from app.models.recipe_view import RecipeView
from app.models.user import User
from app.schemas.recipe import HistoryItem, HistoryResponse, RecipeAuthor
from app.services.recipe import image_url, resolve_authors

# --- カーソル（(viewed_at, recipe_id) の複合） ---------------------------
#
# フィードのカーソルは (created_at, id)、履歴は (viewed_at, recipe_id) と
# 並び順のキーが違うので、エンコード関数も別に持つ（取り違え防止）。

_CURSOR_SEP = "|"


def _encode_history_cursor(viewed_at: datetime, recipe_id: uuid.UUID) -> str:
    raw = f"{viewed_at.isoformat()}{_CURSOR_SEP}{recipe_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_history_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        viewed_at_str, id_str = raw.split(_CURSOR_SEP, 1)
        return datetime.fromisoformat(viewed_at_str), uuid.UUID(id_str)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        # 壊れたカーソル（base64 でない / 区切りが無い / 非 ASCII）は 400 にする
        # （500 にしない。recipe.py の `_decode_cursor` と同じ方針）。
        raise validation_error("ページングカーソルが不正です") from exc


# --- 記録（upsert） ---------------------------------------------------


def record_view(session: Session, user: User, recipe_id: uuid.UUID) -> None:
    """レシピ詳細を開いた記録を残す（features/view-history.md §3・§5）。

    - 見えないレシピ（存在しない / 他人の非公開）は 404（存在を伏せる。api.md）。
    - `INSERT ... ON CONFLICT (user_id, recipe_id) DO UPDATE` の 1 文で「初めて見た →
      行を作る」「もう一度見た → 時刻を更新する」の両方を処理する（レシピごとに
      履歴は 1 行、一覧では常に最後に見た順。view-history.md §4）。

    時刻は **DB 側の時計**で入れる。理由は 2 つ:
    1. Python 側で時刻を作ると、アプリのワーカーごとの時計ずれがそのまま履歴順に出る。
    2. `now()`（＝トランザクション開始時刻）だけだと、同じ (user, recipe) に並行更新が
       来たとき、先に開始したトランザクションが相手の行ロック解放を待って**あとから**
       実行され、**古い開始時刻で新しい閲覧を上書き**してしまう。
    そこで更新側は `GREATEST(既存の viewed_at, clock_timestamp())` にして、
    「今より前の時刻には絶対に戻さない」ことを保証する（単調性）。
    `clock_timestamp()` はトランザクション開始時刻ではなく、その文を実行した瞬間の
    実時刻を返すので、ロック解放後に実行された更新でも正しく「今」になる。
    """
    recipe = session.get(Recipe, recipe_id)
    if recipe is None or (not recipe.is_public and recipe.user_id != user.id):
        raise not_found("レシピが見つかりません")

    stmt = (
        pg_insert(RecipeView)
        .values(user_id=user.id, recipe_id=recipe_id, viewed_at=func.clock_timestamp())
        .on_conflict_do_update(
            index_elements=["user_id", "recipe_id"],
            set_={"viewed_at": func.greatest(RecipeView.viewed_at, func.clock_timestamp())},
        )
    )
    session.execute(stmt)


# --- 一覧 -----------------------------------------------------------


def list_history(
    session: Session,
    user: User,
    *,
    cursor: str | None,
    limit: int,
) -> HistoryResponse:
    """最近見たレシピ一覧（features/view-history.md §5「GET /users/me/history」）。

    並びは `viewed_at DESC, recipe_id DESC`（同時刻は recipe_id で継ぐ）。
    可視性フィルタは `is_public OR author = me`（お気に入りタブと同じ考え方）。
    後から非公開化された他人のレシピは一覧に出ないが、`recipe_views` の行は
    消さない（また公開に戻れば再び出る）。
    """
    stmt = (
        select(Recipe, RecipeView.viewed_at)
        .join(RecipeView, RecipeView.recipe_id == Recipe.id)  # type: ignore[arg-type]
        .where(
            RecipeView.user_id == user.id,
            Recipe.is_public.is_(True) | (Recipe.user_id == user.id),  # type: ignore[attr-defined]
        )
    )

    if cursor is not None:
        c_viewed, c_id = _decode_history_cursor(cursor)
        stmt = stmt.where(
            (RecipeView.viewed_at < c_viewed)
            | ((RecipeView.viewed_at == c_viewed) & (Recipe.id < c_id))
        )

    stmt = stmt.order_by(RecipeView.viewed_at.desc(), Recipe.id.desc()).limit(limit + 1)  # type: ignore[attr-defined]
    rows = list(session.exec(stmt).all())

    has_more = len(rows) > limit
    page = rows[:limit]
    recipes = [recipe for recipe, _ in page]
    authors = resolve_authors(session, recipes)

    items = [
        HistoryItem(
            id=recipe.id,
            title=recipe.title,
            thumbnail_url=image_url(recipe.thumbnail_key),
            author=RecipeAuthor(
                id=authors[recipe.user_id].id,
                display_name=authors[recipe.user_id].display_name,
            ),
            favorite_count=recipe.favorite_count,
            viewed_at=viewed_at,
        )
        for recipe, viewed_at in page
    ]
    next_cursor = None
    if has_more and page:
        last_recipe, last_viewed = page[-1]
        next_cursor = _encode_history_cursor(last_viewed, last_recipe.id)
    return HistoryResponse(items=items, next_cursor=next_cursor)


# --- 全消去 --------------------------------------------------------


def clear_history(session: Session, user: User) -> None:
    """自分の閲覧履歴を全部消す（features/view-history.md §5「DELETE /users/me/history」）。"""
    session.exec(delete(RecipeView).where(RecipeView.user_id == user.id))  # type: ignore[arg-type]
