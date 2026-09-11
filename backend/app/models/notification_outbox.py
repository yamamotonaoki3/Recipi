"""`notification_outbox` テーブルに対応するモデル（notification.md §4・processing-model.md §9）。

## outbox パターンとは

「フォロワー全員に新着レシピ通知を配る」はフォロワーの数だけ INSERT するので重く、
レシピ投稿のリクエストの中ではやりたくない（投稿者を待たせる）。かといって
「コミットしてから別途配る」だけだと、配る前にプロセスが落ちたら配布予定ごと消える。

そこで、レシピ作成と**同じトランザクション**で「配る予定」を 1 行だけこの表に書く。
レシピがコミットされたなら配布予定も必ず残っている。実際の配布は
コミット後の `BackgroundTasks` が行い、それが落ちても定期スイープ
（app/jobs/notification_sweep.py）が未処理の行を拾い直す。

- 1 レシピ 1 行（UNIQUE(`event`, `recipe_id`)）
- `processed_at` が NULL = 未処理。配り終えたら時刻を入れる
- レシピ・投稿者が消えたら行も消える（ON DELETE CASCADE）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

OutboxEvent = Literal["followee_new_recipe"]


def _utcnow() -> datetime:
    return datetime.now(UTC)


class NotificationOutbox(SQLModel, table=True):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        sa.CheckConstraint("event IN ('followee_new_recipe')", name="ck_notification_outbox_event"),
        sa.UniqueConstraint("event", "recipe_id", name="uq_notification_outbox_event_recipe"),
        sa.Index("ix_notification_outbox_processed_at", "processed_at"),
        sa.Index("ix_notification_outbox_recipe_id", "recipe_id"),
        sa.Index("ix_notification_outbox_author_id", "author_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    event: str = Field(nullable=False)

    # 新しく投稿された公開レシピ。
    recipe_id: uuid.UUID = Field(foreign_key="recipes.id", nullable=False, ondelete="CASCADE")

    # 投稿者（この人のフォロワーに配る）。
    author_id: uuid.UUID = Field(foreign_key="users.id", nullable=False, ondelete="CASCADE")

    # レシピの作成時刻と同じ値を入れる。配った通知の `created_at` にもこれを使うので、
    # スイープで遅れて配っても通知は「投稿した時刻」に並ぶ。
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)

    # NULL = 未処理。
    processed_at: datetime | None = Field(default=None, nullable=True)
