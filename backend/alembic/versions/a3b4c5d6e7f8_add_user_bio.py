"""add user bio

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3b4c5d6e7f8"
down_revision: str | Sequence[str] | None = "f2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.String(length=2000), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "bio")
