"""感想（コメント）のドメインロジック（features/comment.md）。

ルーター（app/api/comments.py）は HTTP の入出力だけを担う。

## 誰が何をできるか（comment.md §3）

| 操作 | できる人 |
| --- | --- |
| 一覧 | そのレシピが見える人（公開レシピなら未ログインでも） |
| 投稿 | レシピ投稿者**以外**のログインユーザー（本人は 403） |
| 編集 | 感想の投稿者だけ |
| 削除 | 感想の投稿者、またはレシピの投稿者（モデレーション） |

レシピが見えない人（他人の非公開レシピ）には、どの操作も 404 を返す。後から
非公開化されたレシピでは、感想を書いた本人でも編集・削除は 404
（「非公開レシピの感想 API は他人には 404」を字義どおり適用する）。

## ロック（競合で壊さないために）

- **カウント列**（`recipes.comment_count`）: お気に入りと同じく、`recipes` 行を
  `FOR NO KEY UPDATE` で、`recipe_comments` への INSERT / DELETE より**先に**取る
  （`lock_recipe`。non-functional.md「カウント列キャッシュのトランザクション方針」）
- **感想の行**: 編集・削除では感想の行も `FOR NO KEY UPDATE` で**読み直しながら**
  ロックする。同じ感想の画像を同時に差し替えたとき、両方が古い画像キーを
  「外れたキー」と思い込み、片方の新しい画像が誰にも指されずに残る（孤児）のを
  防ぐため（Issue #67 のアバターと同じ理由）
- ロックの順番は常に **recipes → recipe_comments**（逆順の処理が混ざるとデッドロック）

## このモジュールは commit しない

ルーターが `run_with_retry()` で包んで commit する（お気に入り・フォローと同じ）。

## import の向き

app/services/recipe.py の関数（投稿者の組み立て・レシピのロック）を使う側。
逆向き（recipe.py → ここ）の import は作らない。
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, update
from sqlmodel import Session, select

from app.errors import forbidden, not_found, validation_error
from app.models.recipe import Recipe
from app.models.recipe_comment import RecipeComment
from app.models.user import User
from app.schemas.comment import (
    CommentCreateRequest,
    CommentListResponse,
    CommentResponse,
    CommentUpdateRequest,
)
from app.services.image import consume_upload_keys, enqueue_object_deletion, image_url
from app.services.notification import create_single_notification
from app.services.recipe import author_of, lock_recipe

# --- カーソル（(created_at, id) の複合） ----------------------------------
#
# 並べるキーは「感想を書いた日時」。フィードや他の一覧とはキーが違うので、
# 取り違えないよう専用のエンコードにする（follow.py・favorite.py と同じ方針）。

_CURSOR_SEP = "|"


def _encode_cursor(created_at: datetime, comment_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{comment_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_at_str, id_str = raw.split(_CURSOR_SEP, 1)
        return datetime.fromisoformat(created_at_str), uuid.UUID(id_str)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise validation_error("ページングカーソルが不正です") from exc


# --- 小さな部品 -------------------------------------------------------------


def _is_visible(recipe: Recipe, viewer: User | None) -> bool:
    """そのレシピが閲覧者に見えるか（公開レシピ、または自分のレシピ）。"""
    return recipe.is_public or (viewer is not None and recipe.user_id == viewer.id)


def _lock_comment(session: Session, comment_id: uuid.UUID) -> RecipeComment | None:
    """感想の行を `FOR NO KEY UPDATE` でロックして、DB の最新値で読み直す。

    `populate_existing=True` は、同じ行がセッションに読み込み済みでも DB の値で
    上書きする指定。これが無いと古い `image_key` を見てしまい、同時の差し替えで
    旧キーを取りこぼす（Issue #67 の教訓）。
    """
    return session.exec(
        select(RecipeComment)
        .where(RecipeComment.id == comment_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    ).first()


def _lock_comment_with_recipe(
    session: Session, comment_id: uuid.UUID
) -> tuple[RecipeComment, Recipe] | None:
    """感想とそのレシピを **recipes → recipe_comments の順に**ロックして返す。

    どのレシピの感想かは感想の行を読むまで分からないので、まずロックなしで
    `recipe_id` を知り、レシピ → 感想の順にロックし直す。ロックの間に消されて
    いたら None（呼び出し側で 404）。
    """
    first = session.exec(
        select(RecipeComment.recipe_id).where(RecipeComment.id == comment_id)
    ).first()
    if first is None:
        return None
    recipe = lock_recipe(session, first)
    if recipe is None:
        return None
    comment = _lock_comment(session, comment_id)
    if comment is None or comment.recipe_id != recipe.id:
        return None
    return comment, recipe


def _resolve_users(session: Session, comments: list[RecipeComment]) -> dict[uuid.UUID, User]:
    """感想の投稿者を id → User の対応表で返す（1 ページ分をまとめて 1 クエリ。N+1 回避）。"""
    user_ids = {c.user_id for c in comments}
    if not user_ids:
        return {}
    rows = session.exec(select(User).where(User.id.in_(user_ids))).all()  # type: ignore[attr-defined]
    return {u.id: u for u in rows}


def to_response(comment: RecipeComment, author: User) -> CommentResponse:
    return CommentResponse(
        id=comment.id,
        body=comment.body,
        image_url=image_url(comment.image_key),
        author=author_of(author),
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def _add_to_comment_count(session: Session, recipe_id: uuid.UUID, delta: int) -> None:
    """`recipes.comment_count` を DB の中で原子的に ± する。"""
    session.execute(
        update(Recipe)
        .where(Recipe.id == recipe_id)  # type: ignore[arg-type]
        .values(comment_count=Recipe.comment_count + delta)
    )


# --- 一覧 -------------------------------------------------------------------


def list_comments(
    session: Session,
    viewer: User | None,
    recipe_id: uuid.UUID,
    *,
    cursor: str | None,
    limit: int,
) -> CommentListResponse:
    """`GET /recipes/{id}/comments`: そのレシピの感想を新しい順に返す（comment.md §5）。

    レシピが見えない（存在しない / 他人の非公開）なら 404。公開レシピなら未ログイン
    でも見られる。投稿者は 1 ページ分をまとめて 1 クエリで引く（N+1 回避）。
    """
    recipe = session.get(Recipe, recipe_id)
    if recipe is None or not _is_visible(recipe, viewer):
        raise not_found("レシピが見つかりません")

    stmt = select(RecipeComment).where(RecipeComment.recipe_id == recipe_id)
    if cursor is not None:
        c_created, c_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (RecipeComment.created_at < c_created)
            | ((RecipeComment.created_at == c_created) & (RecipeComment.id < c_id))
        )
    stmt = stmt.order_by(RecipeComment.created_at.desc(), RecipeComment.id.desc()).limit(limit + 1)  # type: ignore[attr-defined]
    rows = list(session.exec(stmt).all())

    has_more = len(rows) > limit
    page = rows[:limit]
    authors = _resolve_users(session, page)
    items = [to_response(c, authors[c.user_id]) for c in page]
    next_cursor = _encode_cursor(page[-1].created_at, page[-1].id) if has_more and page else None
    return CommentListResponse(items=items, next_cursor=next_cursor)


# --- 投稿 / 編集 / 削除 -----------------------------------------------------


def create_comment(
    session: Session, user: User, recipe_id: uuid.UUID, req: CommentCreateRequest
) -> RecipeComment:
    """`POST /recipes/{id}/comments`: 感想を投稿する（comment.md §5）。

    - レシピが見えない → 404。レシピ投稿者本人 → 403
    - 画像キーは本人所有かつ未使用のものだけ（`consume_upload_keys`。違えば 400）
    - `comment_count` を +1 し、レシピ投稿者に `recipe_commented` 通知を同じ Tx で作る
    """
    # ロックは INSERT より先（モジュール冒頭）。レシピ削除とも、このロックで順番待ちになる。
    recipe = lock_recipe(session, recipe_id)
    if recipe is None or not _is_visible(recipe, user):
        raise not_found("レシピが見つかりません")
    if recipe.user_id == user.id:
        raise forbidden("自分のレシピには感想を書けません")

    if req.image_key:
        consume_upload_keys(session, user, [req.image_key])

    comment = RecipeComment(
        recipe_id=recipe_id,
        user_id=user.id,
        body=req.body,
        image_key=req.image_key,
    )
    session.add(comment)
    session.flush()
    # 並び順に使う時刻は DB の時計でその瞬間の値を入れる（`now()` はトランザクション
    # 開始時刻なので、続けて書いた感想の時刻がそろいやすい。lessons #41）。
    session.execute(
        update(RecipeComment)
        .where(RecipeComment.id == comment.id)  # type: ignore[arg-type]
        .values(created_at=func.clock_timestamp(), updated_at=func.clock_timestamp())
    )
    _add_to_comment_count(session, recipe_id, 1)

    create_single_notification(
        session,
        user_id=recipe.user_id,
        type="recipe_commented",
        actor_id=user.id,
        recipe_id=recipe_id,
        comment_id=comment.id,
    )
    session.expire(recipe)
    session.expire(comment)
    return comment


def update_comment(
    session: Session, user: User, comment_id: uuid.UUID, req: CommentUpdateRequest
) -> RecipeComment:
    """`PATCH /comments/{id}`: 感想の投稿者だけが、送られた項目を変える（comment.md §5）。

    画像（`imageKey`）の 4 通り（image.md §3）:

    | 送り方 | 動き |
    | --- | --- |
    | 省略 | 変えない |
    | 今と同じキー | 変えない（すでに使用済みなので消費処理を通さない） |
    | null | 画像を外し、旧キーを削除キューへ |
    | 新しいキー | 本人所有・未使用を確かめて差し替え、旧キーを削除キューへ |

    編集ではカウントも通知も変えない。
    """
    locked = _lock_comment_with_recipe(session, comment_id)
    if locked is None:
        raise not_found("感想が見つかりません")
    comment, recipe = locked
    if not _is_visible(recipe, user):
        raise not_found("感想が見つかりません")
    if comment.user_id != user.id:
        raise forbidden("他のユーザーの感想は編集できません")

    sent = req.model_fields_set
    if "body" in sent and req.body is not None:
        comment.body = req.body

    if "image_key" in sent and req.image_key != comment.image_key:
        old_key = comment.image_key
        if req.image_key is not None:
            consume_upload_keys(session, user, [req.image_key])
        comment.image_key = req.image_key
        # 外れた旧画像は、あとで定期ジョブが実削除する（無ければ何もしない）。
        reason = "comment_image_replaced" if req.image_key else "comment_image_removed"
        enqueue_object_deletion(session, old_key, reason)

    comment.updated_at = datetime.now(UTC)
    session.add(comment)
    return comment


def delete_comment(session: Session, user: User, comment_id: uuid.UUID) -> None:
    """`DELETE /comments/{id}`: 感想の投稿者、またはレシピの投稿者だけが消せる（comment.md §5）。

    画像があれば削除キューに積み、`comment_count` を −1 する。この感想への
    `recipe_commented` 通知は ON DELETE CASCADE で一緒に消える。
    """
    locked = _lock_comment_with_recipe(session, comment_id)
    if locked is None:
        raise not_found("感想が見つかりません")
    comment, recipe = locked
    if not _is_visible(recipe, user):
        raise not_found("感想が見つかりません")
    if user.id not in (comment.user_id, recipe.user_id):
        raise forbidden("この感想を削除する権限がありません")

    enqueue_object_deletion(session, comment.image_key, "comment_deleted")
    session.delete(comment)
    session.flush()
    _add_to_comment_count(session, recipe.id, -1)
    session.expire(recipe)
