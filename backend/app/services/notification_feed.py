"""通知の「読み取り側」: 一覧・未読数・既読化（features/notification.md §5）。

書き込み側（通知を作る・配る）は app/services/notification.py。こちらは投稿者の
組み立て（`recipe.author_of`）を使うので `recipe.py` を import する。`recipe.py` は
書き込み側を import しているため、同じモジュールに置くと循環 import になる。

## 一覧に出す通知（可視性）

- 自分あて（`user_id = 自分`）だけ
- レシピに紐づく通知は、そのレシピが**自分から見える**（公開、または自分のレシピ）
  ものだけ。他人のレシピが非公開になったら、その通知は一覧からも未読数からも隠れる。
  行は消さないので、公開に戻れば戻ってくる（notification.md §8 の既定値。Issue #70）
- レシピ・感想・行為者が削除された通知は、外部キーの ON DELETE CASCADE で
  行ごと消えている。なので特別な条件は要らない

未読数も一覧と**同じ条件**で数える。一覧に出ない未読をバッジに数えると、
いくら開いても減らない数字が残ってしまう。
"""

from __future__ import annotations

import base64
import binascii
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, and_, func, or_, update
from sqlmodel import Session, col, select

from app.errors import validation_error
from app.models.notification import Notification
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.notification import (
    NotificationComment,
    NotificationItem,
    NotificationListResponse,
    NotificationRecipe,
)
from app.services.recipe import author_of

# --- カーソル（(created_at, id) の複合。comment.py などと同じ形式） -----------

_CURSOR_SEP = "|"


def _encode_cursor(created_at: datetime, notification_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{notification_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_at_str, id_str = raw.split(_CURSOR_SEP, 1)
        return datetime.fromisoformat(created_at_str), uuid.UUID(id_str)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise validation_error("ページングカーソルが不正です") from exc


# --- 可視性の条件 -------------------------------------------------------------


def _visible_to(user: User) -> ColumnElement[bool]:
    """自分あて、かつ（レシピなし / 公開レシピ / 自分のレシピ）の通知。

    `recipes` を LEFT JOIN した上で使う（`followed` はレシピが無いので NULL になる）。
    """
    return and_(
        col(Notification.user_id) == user.id,
        or_(
            col(Notification.recipe_id).is_(None),
            col(Recipe.is_public).is_(True),
            col(Recipe.user_id) == user.id,
        ),
    )


def count_unread(session: Session, user: User) -> int:
    """一覧と同じ条件で、未読（`read_at IS NULL`）を数える。"""
    stmt = (
        select(func.count())
        .select_from(Notification)
        .outerjoin(Recipe, col(Recipe.id) == Notification.recipe_id)
        .where(_visible_to(user), col(Notification.read_at).is_(None))
    )
    return int(session.exec(stmt).one())


def list_notifications(
    session: Session, user: User, *, cursor: str | None, limit: int
) -> NotificationListResponse:
    """`GET /notifications`: 自分あての通知を新しい順に返す（未読数も同梱）。

    行為者とレシピは JOIN で一緒に引く（1 ページ 1 クエリ。N+1 にしない）。
    """
    stmt: Any = (
        select(Notification, User, Recipe)
        .join(User, col(User.id) == Notification.actor_id)
        .outerjoin(Recipe, col(Recipe.id) == Notification.recipe_id)
        .where(_visible_to(user))
    )
    if cursor is not None:
        c_created, c_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Notification.created_at < c_created)
            | ((Notification.created_at == c_created) & (Notification.id < c_id))
        )
    stmt = stmt.order_by(col(Notification.created_at).desc(), col(Notification.id).desc()).limit(
        limit + 1
    )
    rows: Sequence[tuple[Notification, User, Recipe | None]] = session.exec(stmt).all()

    has_more = len(rows) > limit
    page = rows[:limit]
    items = [
        NotificationItem(
            id=n.id,
            type=n.type,  # DB の CHECK 制約で 4 種類に限られる
            read_at=n.read_at,
            actor=author_of(actor),
            recipe=NotificationRecipe(id=recipe.id, title=recipe.title) if recipe else None,
            comment=NotificationComment(id=n.comment_id) if n.comment_id else None,
            created_at=n.created_at,
        )
        for n, actor, recipe in page
    ]
    last = page[-1][0] if page else None
    next_cursor = _encode_cursor(last.created_at, last.id) if has_more and last else None
    return NotificationListResponse(
        items=items, unread_count=count_unread(session, user), next_cursor=next_cursor
    )


def mark_read(session: Session, user: User, ids: list[uuid.UUID] | None) -> None:
    """`POST /notifications/read`: 既読にする。コミットは呼び出し側（ルーター）。

    - `ids` が None → 自分の未読をすべて既読に
    - `ids` あり → そのうち自分あてのものだけ（`user_id = 自分` の条件で、他人の ID は
      自然に対象外になる。403 にはせず黙って無視する。notification.md §6）
    - 既読済みの `read_at` は上書きしない（最初に読んだ時刻を残す）
    """
    if ids is not None and not ids:
        return
    stmt = (
        update(Notification)
        .where(
            col(Notification.user_id) == user.id,
            col(Notification.read_at).is_(None),
        )
        .values(read_at=func.clock_timestamp())
    )
    if ids is not None:
        stmt = stmt.where(col(Notification.id).in_(ids))
    session.exec(stmt)
