"""add notification_outbox and followee_new_recipe unique index

Issue #70（Phase 8 通知 API ＋ fan-out）用のスキーマを追加する
（features/notification.md §4・processing-model.md §7・§9）。

- `notification_outbox`: 「フォロワーに新着レシピ通知を配る予定」を 1 レシピ 1 行で持つ。
  公開レシピ作成と同じトランザクションで INSERT するので、レシピだけできて配布予定が
  消える、ということが起きない
  - `processed_at` 以外はすべて NOT NULL（NULL の `recipe_id` は UNIQUE をすり抜け、
    NULL の `created_at` はスイープに拾われず残り続けるため）
  - UNIQUE(`event`, `recipe_id`): 1 レシピ 1 行を DB で保証する
  - index(`processed_at`): 未処理スイープ用。index(`recipe_id`) / index(`author_id`): CASCADE 用
- `notifications`:
  - 部分一意 index (`user_id`, `recipe_id`) WHERE `type = 'followee_new_recipe'`:
    配布が二重に走っても同じ人に同じ新着通知が 2 件できない（`ON CONFLICT DO NOTHING`）
  - 一覧 index を (`user_id`, `created_at` DESC, `id` DESC) に作り直す。fan-out は同じ
    時刻の通知を大量に作るので、id で継がないとページ境界で抜け・重複が出る

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-11

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: str | Sequence[str] | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_outbox",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("event", sa.String(), nullable=False),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("event IN ('followee_new_recipe')", name="ck_notification_outbox_event"),
        sa.UniqueConstraint("event", "recipe_id", name="uq_notification_outbox_event_recipe"),
    )
    op.create_index("ix_notification_outbox_processed_at", "notification_outbox", ["processed_at"])
    op.create_index("ix_notification_outbox_recipe_id", "notification_outbox", ["recipe_id"])
    op.create_index("ix_notification_outbox_author_id", "notification_outbox", ["author_id"])

    op.create_index(
        "uq_notifications_followee_new_recipe",
        "notifications",
        ["user_id", "recipe_id"],
        unique=True,
        postgresql_where=sa.text("type = 'followee_new_recipe'"),
    )
    op.drop_index("ix_notifications_user_id_created_at", table_name="notifications")
    op.create_index(
        "ix_notifications_user_id_created_at",
        "notifications",
        ["user_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_id_created_at", table_name="notifications")
    op.create_index(
        "ix_notifications_user_id_created_at",
        "notifications",
        ["user_id", sa.text("created_at DESC")],
    )
    op.drop_index("uq_notifications_followee_new_recipe", table_name="notifications")
    op.drop_index("ix_notification_outbox_author_id", table_name="notification_outbox")
    op.drop_index("ix_notification_outbox_recipe_id", table_name="notification_outbox")
    op.drop_index("ix_notification_outbox_processed_at", table_name="notification_outbox")
    op.drop_table("notification_outbox")
