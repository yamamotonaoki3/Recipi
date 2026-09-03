"""baseline (empty)

マイグレーションの起点となる空のリビジョン。
Phase 1 以降、テーブルを追加するたびに新しいリビジョンを積み重ねる。

Revision ID: 8590258fb6e2
Revises:
Create Date: 2026-09-04

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "8590258fb6e2"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """このリビジョンでスキーマに加える変更（起点なので何もしない）。"""
    pass


def downgrade() -> None:
    """upgrade を打ち消す変更（起点なので何もしない）。"""
    pass
