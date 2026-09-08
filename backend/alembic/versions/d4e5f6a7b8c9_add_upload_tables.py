"""add upload tables (uploads, pending_storage_deletions)

Issue #39（Phase 3 画像アップロード）用のテーブルを追加する。

- `uploads`: 一時アップロードの管理行。`pending` → `stored` → `consumed`
  の状態機械を持ち、本参照されないまま残ったものを GC が回収する。
  キーはオブジェクトを置く前に INSERT で確定する（processing-model.md §9）。
- `pending_storage_deletions`: 「参照から外れたオブジェクトキー」の削除キュー。
  登録は発火元と同一トランザクション、実削除は定期ジョブが行うことで、
  ストレージ障害を削除 API に波及させない（processing-model.md §5-2・§8）。

DB レベルの制約が正（data-model.md）:
- CHECK: `uploads.status` は 3 値のみ / `size_bytes >= 0` / `attempts >= 0`
- UNIQUE: `uploads.key`（同じキーの管理行が二重に作られないように）
- `pending_storage_deletions.key` は **あえて UNIQUE にしない**
  （重複登録を許容する冪等設計。削除ジョブは「既に無い」を成功扱いにする）

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """`uploads` / `pending_storage_deletions` を作成する。

    UUID の既定値はアプリ側（uuid4）で発行するため SERVER DEFAULT は付けない
    （既存テーブルと同じ方針）。
    """
    # --- uploads（一時アップロードの管理行） ---------------------------
    op.create_table(
        "uploads",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'stored', 'consumed')",
            name="ck_uploads_status",
        ),
        sa.CheckConstraint("size_bytes >= 0", name="ck_uploads_size_bytes_non_negative"),
        sa.UniqueConstraint("key", name="uq_uploads_key"),
    )
    op.create_index("ix_uploads_user_id", "uploads", ["user_id"])
    op.create_index("ix_uploads_key", "uploads", ["key"])
    # GC の OR 条件は、pending では expires_at、stored では created_at と
    # 比較する。各枝が別の列を使うため、1 本の索引で両方を効率よく引く
    # ことはできず、それぞれに status から始まる複合索引が必要になる。
    op.create_index("ix_uploads_status_expires_at", "uploads", ["status", "expires_at"])
    op.create_index("ix_uploads_status_created_at", "uploads", ["status", "created_at"])

    # --- pending_storage_deletions（削除キュー） -----------------------
    op.create_table(
        "pending_storage_deletions",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.CheckConstraint("attempts >= 0", name="ck_pending_deletions_attempts_non_negative"),
    )
    op.create_index("ix_pending_deletions_key", "pending_storage_deletions", ["key"])
    # 削除ジョブが「試行回数が少ないものから古い順に」取り出すための索引。
    op.create_index(
        "ix_pending_deletions_attempts_enqueued_at",
        "pending_storage_deletions",
        ["attempts", "enqueued_at"],
    )


def downgrade() -> None:
    """upgrade で作ったテーブルを削除する（相互の FK は無いので順不同）。"""
    # 既存 DB は索引追加前のこのリビジョンを適用済みの場合があるため、
    # その DB からの downgrade でも失敗しないよう、無ければ何もしない。
    op.drop_index("ix_uploads_status_created_at", table_name="uploads", if_exists=True)
    op.drop_index("ix_uploads_status_expires_at", table_name="uploads")
    op.drop_table("pending_storage_deletions")
    op.drop_table("uploads")
