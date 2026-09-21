"""add reauth attempts

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
"""

import sqlalchemy as sa

from alembic import op

# 親は「現在の唯一の head」を指す。別の migration と同じ親を指すと head が 2 つに
# 分岐し、`alembic upgrade head` が「Multiple head revisions」で失敗する（Issue #199）。
revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reauth_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("ip_address", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # レート制限は「直近 15 分の user_id 単位 / ip_address 単位の件数」を数えるので、
    # それぞれに created_at を足した複合索引にする。掃除ジョブは created_at だけで
    # 探すため、単独の索引も別に張る。
    op.create_index("ix_reauth_attempts_user_created", "reauth_attempts", ["user_id", "created_at"])
    op.create_index(
        "ix_reauth_attempts_ip_created", "reauth_attempts", ["ip_address", "created_at"]
    )
    op.create_index("ix_reauth_attempts_created_at", "reauth_attempts", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_reauth_attempts_created_at", table_name="reauth_attempts")
    op.drop_index("ix_reauth_attempts_ip_created", table_name="reauth_attempts")
    op.drop_index("ix_reauth_attempts_user_created", table_name="reauth_attempts")
    op.drop_table("reauth_attempts")
