"""`ingredient_groups` テーブルに対応するモデル。

レシピの材料は「グループ」に分けて持つ（例: 「合わせ調味料A」「生地B」）。
グループを作っていないレシピは **名前なしグループ 1 つ**にすべての材料が
入る（features/recipe.md §2「材料グループ」）。

`UNIQUE(id, recipe_id)` を張っているのは、子テーブル `ingredients` から
**複合外部キー `(group_id, recipe_id)` → `ingredient_groups(id, recipe_id)`**
で参照させ、「材料の recipe_id と親グループの recipe_id が必ず一致する」ことを
DB レベルで保証するため（PostgreSQL の CHECK は他テーブルの行を見られない
ので、複合 FK で担保する。docs/lessons-learned.md 2026-09-01 材料リスト拡張 #1）。
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


class IngredientGroup(SQLModel, table=True):
    __tablename__ = "ingredient_groups"
    __table_args__ = (
        # グループの並び順はレシピ内で一意（1 起点の連番。サーバーが振る）。
        sa.UniqueConstraint("recipe_id", "position", name="uq_ingredient_groups_recipe_position"),
        # ↓ ingredients からの複合 FK の参照先。
        sa.UniqueConstraint("id", "recipe_id", name="uq_ingredient_groups_id_recipe"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    recipe_id: uuid.UUID = Field(
        foreign_key="recipes.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
    )

    # グループ名。NULL / 空文字 = 名前なしグループ（詳細画面では見出しなしの
    # フラット表示になる）。0〜40 文字の上限は API 層で担保する。
    name: str | None = Field(default=None, nullable=True)

    # グループ内での表示順（1 起点の連番。サーバーが配列順から振る）。
    position: int = Field(nullable=False)
