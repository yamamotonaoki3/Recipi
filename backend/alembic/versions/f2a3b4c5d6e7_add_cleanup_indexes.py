"""add indexes for periodic cleanup jobs

Issue #72（定期ジョブ）用の索引。掃除ジョブが「消してよい行」を探すときに、
表全体を読まずに済むようにする。

- `refresh_tokens(chain_id, expires_at)`: トークン掃除は「同じチェーンにまだ期限の
  切れていない（または期限切れから日が浅い）トークンが無いか」をチェーンごとに調べる。
  既存の単独索引 `ix_refresh_tokens_chain_id` は、この複合索引の先頭列で同じ検索に
  使えるので置き換える（重複した索引を持たない）
- `refresh_tokens(expires_at)`: 掃除は最初に「期限切れの行」で候補を絞る。上の複合索引は
  先頭が chain_id なので、期限だけの絞り込みには使えない。期限が先頭の索引を別に持つ
- `notifications(read_at) WHERE read_at IS NOT NULL`: 既読通知の掃除用の部分索引。
  未読（read_at IS NULL）は掃除の対象外なので索引に含めず、小さく保つ

`notification_outbox(processed_at)` と `recipe_views(user_id, viewed_at DESC)` は既存。

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-12

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: str | Sequence[str] | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_refresh_tokens_chain_id_expires_at",
        "refresh_tokens",
        ["chain_id", "expires_at"],
    )
    op.drop_index("ix_refresh_tokens_chain_id", table_name="refresh_tokens")
    op.create_index("ix_refresh_tokens_expires_at", "refresh_tokens", ["expires_at"])
    op.create_index(
        "ix_notifications_read_at",
        "notifications",
        ["read_at"],
        postgresql_where=sa.text("read_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_read_at", table_name="notifications")
    # この索引は同じリビジョンに後から足した（Codex レビュー）。足す前の版を適用済みの
    # 開発・テスト DB でも downgrade が通るよう、無ければ何もしない。
    op.drop_index("ix_refresh_tokens_expires_at", table_name="refresh_tokens", if_exists=True)
    op.create_index("ix_refresh_tokens_chain_id", "refresh_tokens", ["chain_id"])
    op.drop_index("ix_refresh_tokens_chain_id_expires_at", table_name="refresh_tokens")
