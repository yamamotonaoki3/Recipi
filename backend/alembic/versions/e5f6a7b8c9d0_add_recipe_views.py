"""add recipe_views table

Issue #41（Phase 4 閲覧履歴）用のテーブルを追加する。

- `recipe_views`: 「ユーザー × レシピ」ごとに 1 行、最後に見た時刻を持つ。
  再閲覧は `INSERT ... ON CONFLICT (user_id, recipe_id) DO UPDATE SET viewed_at = now()`
  の upsert で処理する（features/view-history.md §4）。
- 一覧クエリ（自分の行を viewed_at の新しい順）のために
  index(`user_id`, `viewed_at` DESC) を張る。
- レシピ削除時の ON DELETE CASCADE が `recipe_id` で行を探せるよう
  index(`recipe_id`) も張る（FK 列は自動 index されない）。
- `user_id` / `recipe_id` はどちらも ON DELETE CASCADE。ユーザーやレシピが
  消えたら履歴行も一緒に消える（data-model.md）。

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """`recipe_views` を作成する。

    主キーは `(user_id, recipe_id)` の複合。これにより「レシピごとに 1 行」が
    DB レベルで保証され、upsert の ON CONFLICT ターゲットにもできる。
    """
    op.create_table(
        "recipe_views",
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=False),
    )
    # 一覧は WHERE user_id = ? ORDER BY viewed_at DESC。並び順まで index に
    # 含めておくと、PostgreSQL がソートを省いて index を逆順に読める。
    op.create_index(
        "ix_recipe_views_user_id_viewed_at",
        "recipe_views",
        ["user_id", sa.text("viewed_at DESC")],
    )
    # レシピ削除時の CASCADE が recipe_id で行を引けるようにする（FK 列は
    # 自動 index されず、無いと 1 レシピ削除ごとに全行スキャンになる）。
    op.create_index("ix_recipe_views_recipe_id", "recipe_views", ["recipe_id"])


def downgrade() -> None:
    # 既存 DB がこのリビジョンを「index 追加前」の状態で適用済みのことがあるため、
    # 無ければ何もしない（d4e5f6a7b8c9 の downgrade と同じ方針）。
    op.drop_index("ix_recipe_views_recipe_id", table_name="recipe_views", if_exists=True)
    op.drop_index("ix_recipe_views_user_id_viewed_at", table_name="recipe_views", if_exists=True)
    op.drop_table("recipe_views")
