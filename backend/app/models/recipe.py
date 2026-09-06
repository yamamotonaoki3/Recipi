"""`recipes` テーブルに対応するモデル。

レシピ本体（タイトル・説明・何人分・公開フラグ・サムネイル画像キー・
非正規化カウント列）を持つ。材料グループ / 材料 / 手順は別テーブル
（`ingredient_groups` / `ingredients` / `steps`）に分け、FK の
`ON DELETE CASCADE` でレシピと一緒に消えるようにする（features/recipe.md §4）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Recipe(SQLModel, table=True):
    __tablename__ = "recipes"
    __table_args__ = (
        # 何人分は 1〜99（features/recipe.md のバリデーション表）。
        # API 層（Pydantic）でも同じ制約をかけるが、DB を「最後の砦」にする
        # ため CHECK 制約も張る（data-model.md「DB レベルの制約が正」）。
        sa.CheckConstraint("servings >= 1 AND servings <= 99", name="ck_recipes_servings_range"),
        sa.CheckConstraint("favorite_count >= 0", name="ck_recipes_favorite_count_non_negative"),
        sa.CheckConstraint("comment_count >= 0", name="ck_recipes_comment_count_non_negative"),
        # ホームフィード（Phase 4）で「公開レシピを新着順」に引くための複合 index。
        sa.Index("ix_recipes_is_public_created_at", "is_public", "created_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
    )

    title: str = Field(nullable=False)
    # 検索用の正規化済みタイトル（app/text_normalize.normalize_search_text で生成）。
    # 「1 つのタイトル」という単一値の正規化であって、検索語の分割とは無関係。
    title_normalized: str = Field(nullable=False, index=True)

    description: str = Field(default="", nullable=False)
    servings: int = Field(nullable=False)
    is_public: bool = Field(default=False, nullable=False)

    # 画像は「オブジェクトキー（文字列）」だけを持つ。表示用 URL はレスポンス
    # 生成時にキーから組み立てる（features/image.md / recipe.md §5）。
    # 一時アップロード（POST /images）の所有・未使用チェックは Phase 3。
    thumbnail_key: str | None = Field(default=None, nullable=True)

    # 非正規化カウント（お気に入り数 / 感想数）。実際の増減は Phase 6 / 7。
    favorite_count: int = Field(default=0, nullable=False)
    comment_count: int = Field(default=0, nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=_utcnow, nullable=False)
