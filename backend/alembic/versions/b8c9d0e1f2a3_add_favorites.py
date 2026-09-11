"""add favorites

Issue #68（Phase 6 お気に入り）用に `favorites` テーブルを追加する
（features/favorite.md §4・data-model.md）。

- 主キー `(user_id, recipe_id)`: 二重登録を DB レベルで防ぎ、
  `INSERT ... ON CONFLICT DO NOTHING` の衝突対象にもする
- 両方の外部キーは ON DELETE CASCADE（ユーザー削除・レシピ削除で行ごと消える）
- index(`recipe_id`): 逆引き（補正ジョブ・「このレシピをお気に入りした人」）と、
  レシピ削除時の CASCADE が行を探すため。PostgreSQL は FK 列を自動 index しない
- index(`user_id`, `created_at` DESC, `recipe_id` DESC): お気に入り一覧
  （`GET /users/me/favorites` / `feed=favorites`）の並びとカーソル条件に一致させる

`recipes.favorite_count`（カウント列）は既存なので、このリビジョンでは触らない。

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-11

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: str | Sequence[str] | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorites",
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_favorites_recipe_id", "favorites", ["recipe_id"])
    op.create_index(
        "ix_favorites_user_id_created_at",
        "favorites",
        ["user_id", sa.text("created_at DESC"), sa.text("recipe_id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_favorites_user_id_created_at", table_name="favorites", if_exists=True)
    op.drop_index("ix_favorites_recipe_id", table_name="favorites", if_exists=True)
    op.drop_table("favorites")
