"""add pending_storage_deletions.delete_after

Issue #71（アカウント削除）用。削除キューの行に「この時刻より後に消す」を持たせる。

アカウント削除では、本人がアップロード途中（`uploads.status = 'pending'`。行は
コミット済みでオブジェクトの PUT がまだ終わっていない）のキーも削除キューに積む。
削除ジョブがすぐに消すと、その後で PUT が終わってオブジェクトが残ってしまう。
pending のキーだけは期限を過ぎてから消すよう、この列で遅らせる。
NULL は「すぐ消してよい」（従来どおり）。

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-09-11

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: str | Sequence[str] | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pending_storage_deletions",
        sa.Column("delete_after", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("pending_storage_deletions", "delete_after")
