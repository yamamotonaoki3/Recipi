"""add recipe_comments and notifications.comment_id

Issue #69（Phase 7 感想）用のスキーマを追加する（features/comment.md §4・
data-model.md・notification.md）。

- `recipe_comments`: 感想 1 件 = 1 行。1 人が同じレシピに何件でも書ける（一意制約なし）
  - 本文は 1〜1000 文字を CHECK で DB 側にも持つ（API 層で前後の空白を除いてから
    検証するが、DB を最後の砦にする。data-model.md「DB レベルの制約が正」）
  - index(`recipe_id`, `created_at` DESC, `id` DESC): 感想一覧の並び・カーソル条件に一致
  - index(`user_id`): アカウント削除の ON DELETE CASCADE が行を探すため
    （PostgreSQL は FK 列を自動 index しない）
- `notifications.comment_id`: Issue #66 では参照先の `recipe_comments` が無く作れなかった
  列。感想が消えたら通知も消える（ON DELETE CASCADE）

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-11

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: str | Sequence[str] | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recipe_comments",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("image_key", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "char_length(body) BETWEEN 1 AND 1000", name="ck_recipe_comments_body_length"
        ),
    )
    op.create_index(
        "ix_recipe_comments_recipe_id_created_at",
        "recipe_comments",
        ["recipe_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index("ix_recipe_comments_user_id", "recipe_comments", ["user_id"])

    op.add_column(
        "notifications",
        sa.Column(
            "comment_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey(
                "recipe_comments.id",
                ondelete="CASCADE",
                name="fk_notifications_comment_id_recipe_comments",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_notifications_comment_id", "notifications", ["comment_id"])


def downgrade() -> None:
    op.drop_index("ix_notifications_comment_id", table_name="notifications", if_exists=True)
    op.drop_constraint(
        "fk_notifications_comment_id_recipe_comments", "notifications", type_="foreignkey"
    )
    op.drop_column("notifications", "comment_id")

    op.drop_index("ix_recipe_comments_user_id", table_name="recipe_comments", if_exists=True)
    op.drop_index(
        "ix_recipe_comments_recipe_id_created_at", table_name="recipe_comments", if_exists=True
    )
    op.drop_table("recipe_comments")
