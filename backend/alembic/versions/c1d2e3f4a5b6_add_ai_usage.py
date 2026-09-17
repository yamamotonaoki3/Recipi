"""add ai usage counters

Revision ID: c1d2e3f4a5b6
Revises: b4c5d6e7f8a9
"""

import sqlalchemy as sa

from alembic import op

# ID は他の migration と重複させない（`a1b2c3d4e5f6` は add_auth_tables が使用中）。
# 親は「現在の唯一の head」を指す。別の migration と同じ親を指すと head が 2 つに
# 分岐し、`alembic upgrade head` が「Multiple head revisions」で失敗する（Issue #199）。
revision = "c1d2e3f4a5b6"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("window_kind", sa.String(), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "window_kind", "window_start", name="uq_ai_usage_user_window"
        ),
    )
    op.create_index("ix_ai_usage_user_id", "ai_usage", ["user_id"])
    op.create_index("ix_ai_usage_window_start", "ai_usage", ["window_start"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_window_start", table_name="ai_usage")
    op.drop_index("ix_ai_usage_user_id", table_name="ai_usage")
    op.drop_table("ai_usage")
