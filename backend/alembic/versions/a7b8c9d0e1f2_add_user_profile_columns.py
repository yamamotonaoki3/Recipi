"""add user profile columns (avatar, email / SNS visibility)

Issue #67（Phase 5 プロフィール拡張 ＋ アバター）用に `users` へ列を足す
（features/profile.md §4）。

- `avatar_key`: アバター画像のオブジェクトキー。表示用 URL はキーから作る派生値で、
  DB には保存しない（features/image.md §4）。
- `email_public` / `x_public` / `instagram_public` / `other_public`:
  各項目をプロフィールで公開するかのトグル。**既定はすべて非公開（false）**。
- `x_url` / `instagram_url` / `other_url`: SNS 等の URL（任意）。上限 2048 文字は
  API 層（Pydantic）で検証し、列の長さでも同じ上限を持たせる。

## DB のデフォルトを残す理由

トグルは `server_default=false` を付けて追加し、**あとで外さない**。
既存行の埋め戻しに要るだけでなく、アプリのモデルを通らない INSERT
（管理用 SQL など）でも値を省略できるようにするため。既存の `token_version` /
`following_count` と同じ形（Issue #66 の Codex レビューで、デフォルトを外した
実装が指摘された。lessons-learned 2026-09-10 #9）。

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-11

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: str | Sequence[str] | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# URL 列の最大長（API 層の検証と同じ値）。
URL_MAX_LENGTH = 2048

_VISIBILITY_COLUMNS = ("email_public", "x_public", "instagram_public", "other_public")
_URL_COLUMNS = ("x_url", "instagram_url", "other_url")


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_key", sa.String(), nullable=True))

    for name in _VISIBILITY_COLUMNS:
        op.add_column(
            "users",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    for name in _URL_COLUMNS:
        op.add_column("users", sa.Column(name, sa.String(URL_MAX_LENGTH), nullable=True))


def downgrade() -> None:
    for name in reversed(_URL_COLUMNS):
        op.drop_column("users", name)
    for name in reversed(_VISIBILITY_COLUMNS):
        op.drop_column("users", name)
    op.drop_column("users", "avatar_key")
