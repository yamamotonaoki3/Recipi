"""`favorites` テーブルに対応するモデル（features/favorite.md §4）。

「誰がどのレシピをお気に入り（♡）したか」を 1 行 = 1（ユーザー → レシピ）で持つ。

## なぜ複合主キー `(user_id, recipe_id)` か

- 「同じレシピを二重にお気に入りできない」を DB レベルで保証できる。
- 主キーをそのまま `INSERT ... ON CONFLICT DO NOTHING` の衝突対象にできるので、
  「まだなら 1 行作る / あれば何もしない」を 1 文で書ける。実際に 1 行入ったか
  どうかで `recipes.favorite_count` を増やすか決める（app/services/favorite.py）。

## 2 つの index

- `recipe_id`: 主キーの索引は `(user_id, recipe_id)` の順なので、レシピ側から
  引く用途（補正ジョブの数え直し・レシピ削除時の CASCADE）には効かない。
  PostgreSQL は FK 列を自動では index しないので明示する。
- `(user_id, created_at DESC, recipe_id DESC)`: お気に入り一覧は
  「登録日時の新しい順」なので、並びとカーソル条件にそのまま合わせる。

## 非公開化・削除との関係

他人のレシピが**非公開化**されても行は残す（一覧に出さないだけ。favorite.md §3）。
レシピが**削除**されたら ON DELETE CASCADE で行ごと消える。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Favorite(SQLModel, table=True):
    __tablename__ = "favorites"
    __table_args__ = (
        sa.Index("ix_favorites_recipe_id", "recipe_id"),
        sa.Index(
            "ix_favorites_user_id_created_at",
            "user_id",
            sa.text("created_at DESC"),
            sa.text("recipe_id DESC"),
        ),
    )

    # お気に入りした人。
    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        ondelete="CASCADE",
        primary_key=True,
    )
    # お気に入りされたレシピ。このレシピの `favorite_count` が増える。
    recipe_id: uuid.UUID = Field(
        foreign_key="recipes.id",
        ondelete="CASCADE",
        primary_key=True,
    )

    # 登録日時。お気に入り一覧はこの新しい順に並べる。
    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
