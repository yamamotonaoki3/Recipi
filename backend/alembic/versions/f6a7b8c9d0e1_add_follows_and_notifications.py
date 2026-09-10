"""add follows, notifications and user count columns

Issue #66（Phase 5 フォロー / フォロワー ＋ 通知基盤）用のスキーマを追加する。

- `follows`: 片方向フォローの関係表（features/follow.md §4）。
  主キー `(follower_id, followee_id)` で二重フォローを DB レベルで防ぎ、
  `ON CONFLICT DO NOTHING` の衝突対象にもする。
- `users.following_count` / `follower_count`: カウント列キャッシュ
  （non-functional.md）。`follows` の増減と同一トランザクションで ±1 する。
- `notifications`: アプリ内通知（features/notification.md §4）。
  このリビジョンでは `comment_id` 列を作らない（参照先の `recipe_comments`
  がまだ存在しないため、感想の Issue で `ALTER TABLE ADD COLUMN` する）。

DB レベルの制約が正（data-model.md）:
- CHECK: `follows.follower_id <> followee_id`（自分自身をフォローできない）
- CHECK: `users.following_count >= 0` / `follower_count >= 0`
- CHECK: `notifications.type` は 4 値のみ
- 部分 index: `notifications(user_id) WHERE read_at IS NULL`（未読件数用）

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: str | Sequence[str] | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- users のカウント列 -------------------------------------------
    #
    # 既存行にも値が要るので `server_default="0"` を付けて追加する。
    # そのあと server_default を外すのは、以後の INSERT で「アプリが必ず
    # 値を書く」ことを明示するため（既存の設計と同じく、DB のデフォルトに
    # 依存せずアプリ側のモデルを正とする）。
    op.add_column(
        "users",
        sa.Column("following_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("follower_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("users", "following_count", server_default=None)
    op.alter_column("users", "follower_count", server_default=None)
    op.create_check_constraint(
        "ck_users_following_count_non_negative", "users", "following_count >= 0"
    )
    op.create_check_constraint(
        "ck_users_follower_count_non_negative", "users", "follower_count >= 0"
    )

    # --- follows ------------------------------------------------------
    op.create_table(
        "follows",
        sa.Column(
            "follower_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "followee_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("follower_id <> followee_id", name="ck_follows_no_self_follow"),
    )
    # 主キーの索引は (follower_id, followee_id) の順なので「A をフォローして
    # いる人」の逆引きには効かない。フォロワー一覧・ホームの「フォロワー」タブ・
    # 補正ジョブ・ユーザー削除時の CASCADE がこの列を使う。
    op.create_index("ix_follows_followee_id", "follows", ["followee_id"])

    # --- notifications ------------------------------------------------
    op.create_table(
        "notifications",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column(
            "actor_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('followed', 'recipe_favorited', 'recipe_commented', 'followee_new_recipe')",
            name="ck_notifications_type",
        ),
    )
    op.create_index(
        "ix_notifications_user_id_created_at",
        "notifications",
        ["user_id", sa.text("created_at DESC")],
    )
    # 未読件数（バッジ）専用。既読行を索引に含めないので、既読がいくら増えても
    # この索引は小さいまま = 件数カウントが速い。
    op.create_index(
        "ix_notifications_user_id_unread",
        "notifications",
        ["user_id"],
        postgresql_where=sa.text("read_at IS NULL"),
    )
    op.create_index("ix_notifications_actor_id", "notifications", ["actor_id"])
    op.create_index("ix_notifications_recipe_id", "notifications", ["recipe_id"])


def downgrade() -> None:
    op.drop_index("ix_notifications_recipe_id", table_name="notifications", if_exists=True)
    op.drop_index("ix_notifications_actor_id", table_name="notifications", if_exists=True)
    op.drop_index("ix_notifications_user_id_unread", table_name="notifications", if_exists=True)
    op.drop_index("ix_notifications_user_id_created_at", table_name="notifications", if_exists=True)
    op.drop_table("notifications")

    op.drop_index("ix_follows_followee_id", table_name="follows", if_exists=True)
    op.drop_table("follows")

    op.drop_constraint("ck_users_follower_count_non_negative", "users", type_="check")
    op.drop_constraint("ck_users_following_count_non_negative", "users", type_="check")
    op.drop_column("users", "follower_count")
    op.drop_column("users", "following_count")
