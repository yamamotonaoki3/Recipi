"""`follows` テーブルに対応するモデル（features/follow.md §4）。

「誰が誰をフォローしているか」を 1 行 = 1（フォローする人 → される人）で持つ。

## 片方向フォロー（Twitter 型）

A が B をフォローしても、B → A の行は作られない。相互フォローは
「B も別途 A をフォローして (B → A) の行ができた」状態にすぎない。
承認制・ブロック機能は対象外（roadmap.md「決定済み」）。

## なぜ複合主キー `(follower_id, followee_id)` か

- 「同じ相手を二重フォローできない」を DB レベルで保証できる。
- 主キーをそのまま `INSERT ... ON CONFLICT DO NOTHING` の衝突対象にできるので、
  「まだフォローしていなければ 1 行作る / していれば何もしない」を 1 文で書ける。
  さらに**実行行数が 1 か 0 か**で「実際に増えたか」を判定でき、
  カウント列（`users.following_count` / `follower_count`）の増減を
  取りこぼさずに済む（app/services/follow.py 参照）。

## index(`followee_id`) を明示する理由

主キーの索引は `(follower_id, followee_id)` の順なので「A がフォローしている
人」（＝ follower_id で引く）は速いが、「A をフォローしている人」（＝ followee_id
で引く）には効かない。フォロワー一覧・ホームの「フォロワー」タブ・カウント補正
ジョブがこの逆引きを使うため、専用の索引を張る。ユーザー削除時の
ON DELETE CASCADE がこの列で行を探すのにも効く（PostgreSQL は FK 列を
自動 index しない）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Follow(SQLModel, table=True):
    __tablename__ = "follows"
    __table_args__ = (
        # 自分自身はフォローできない（follow.md §3）。API 層でも 400 にするが、
        # DB を「最後の砦」にする（data-model.md「DB レベルの制約が正」）。
        sa.CheckConstraint("follower_id <> followee_id", name="ck_follows_no_self_follow"),
        sa.Index("ix_follows_followee_id", "followee_id"),
    )

    # フォローする側（A）。この人の `following_count` が増える。
    follower_id: uuid.UUID = Field(
        foreign_key="users.id",
        ondelete="CASCADE",
        primary_key=True,
    )
    # フォローされる側（B）。この人の `follower_count` が増える。
    followee_id: uuid.UUID = Field(
        foreign_key="users.id",
        ondelete="CASCADE",
        primary_key=True,
    )

    # timestamptz で持つ（列の timezone=True 指定はマイグレーション側。既存モデルと同じ方針）。
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
