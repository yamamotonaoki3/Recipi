"""add auth tables (users, refresh_tokens, password_reset_attempts)

Issue #35（認証）用のテーブルを追加する。

Revision ID: a1b2c3d4e5f6
Revises: 8590258fb6e2
Create Date: 2026-09-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "8590258fb6e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """`users` / `refresh_tokens` / `password_reset_attempts` を作成する。

    UUID の既定値は Postgres の拡張（pgcrypto の gen_random_uuid 等）には
    頼らず、アプリ側（SQLModel の default_factory=uuid4）で発行する。
    そのため DB 側には SERVER DEFAULT を付けない。
    """
    op.create_table(
        "users",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("security_question", sa.String(), nullable=False),
        sa.Column("security_answer_hash", sa.String(), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("chain_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remember_me", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_chain_id", "refresh_tokens", ["chain_id"])
    op.create_index(
        "ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True
    )

    op.create_table(
        "password_reset_attempts",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("ip_address", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_password_reset_attempts_email", "password_reset_attempts", ["email"]
    )
    op.create_index(
        "ix_password_reset_attempts_ip_address", "password_reset_attempts", ["ip_address"]
    )


def downgrade() -> None:
    """upgrade で作ったテーブルを FK 依存の逆順で削除する。"""
    op.drop_table("password_reset_attempts")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
