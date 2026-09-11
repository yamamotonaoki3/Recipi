"""`recipe_comments` テーブルに対応するモデル（features/comment.md §4）。

レシピに付く感想 1 件 = 1 行。本文と、任意で画像 1 枚（`image_key`）を持つ。

- 1 人が同じレシピに**何件でも**書ける（お気に入りと違って一意制約は無い）
- レシピ投稿者本人は自分のレシピに書けない（API 層で 403。comment.md §3）
- レシピが削除される / 感想の投稿者が退会すると、ON DELETE CASCADE で行ごと消える。
  感想画像のキーは、行が消える前に削除キューへ積む（app/services/recipe.py の
  `delete_recipe`。行が消えた後ではキーを取り出せないため）

## index

- `(recipe_id, created_at DESC, id DESC)`: 感想一覧は「そのレシピの感想を新しい順」。
  並びとカーソル条件にそのまま合わせる
- `user_id`: アカウント削除の CASCADE が行を探すため（PostgreSQL は FK 列を
  自動では index しない）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

# 本文の長さ（features/comment.md §6）。API 層（前後の空白を除いてから）と DB の
# CHECK 制約の両方で同じ値を使う。
COMMENT_BODY_MAX_LENGTH = 1000


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RecipeComment(SQLModel, table=True):
    __tablename__ = "recipe_comments"
    __table_args__ = (
        sa.CheckConstraint(
            "char_length(body) BETWEEN 1 AND 1000", name="ck_recipe_comments_body_length"
        ),
        sa.Index(
            "ix_recipe_comments_recipe_id_created_at",
            "recipe_id",
            sa.text("created_at DESC"),
            sa.text("id DESC"),
        ),
        sa.Index("ix_recipe_comments_user_id", "user_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 感想が付くレシピ。この感想の数が `recipes.comment_count` に数えられる。
    recipe_id: uuid.UUID = Field(foreign_key="recipes.id", nullable=False, ondelete="CASCADE")

    # 感想の投稿者（編集・削除できる人）。
    user_id: uuid.UUID = Field(foreign_key="users.id", nullable=False, ondelete="CASCADE")

    # 本文（前後の空白を除いた値を保存する）。
    body: str = Field(nullable=False, sa_type=sa.Text)

    # 添付画像のオブジェクトキー（任意）。表示用 URL はキーから組み立てる派生値。
    image_key: str | None = Field(default=None, nullable=True)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=_utcnow, nullable=False)
