"""add index on password_reset_attempts.created_at for the cleanup job

掃除ジョブ（app/jobs/cleanup_password_reset_attempts.py）は `created_at <= cutoff` で
古い記録を探す。インデックスが無いと行が増えるほど全件を読むことになり、掃除が遅れて
保持期間を過ぎた個人情報（メール・IP）が残り続けるおそれがある（Issue #85）。

Revision ID: b4c5d6e7f8a9
Revises: f7a8b9c0d1e2
Create Date: 2026-09-15
"""

from alembic import op

revision = "b4c5d6e7f8a9"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_password_reset_attempts_created_at", "password_reset_attempts", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_password_reset_attempts_created_at", table_name="password_reset_attempts")
