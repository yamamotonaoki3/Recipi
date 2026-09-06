"""`ingredients` テーブルに対応するモデル。

1 材料 = 材料名 ＋ 数量（任意）＋ 単位（任意・自由入力文字列）。
材料行は「自分の別レシピへのリンク」にできる（`ref_recipe_id`）。

外部キーが 3 本ある:
1. `recipe_id` → `recipes.id`（CASCADE）… レシピ削除で材料も消える
2. 複合 `(group_id, recipe_id)` → `ingredient_groups(id, recipe_id)`（CASCADE）
   … 親グループの recipe_id と一致することを保証しつつ、グループ削除でも消す
3. `ref_recipe_id` → `recipes.id`（**SET NULL**）… 参照先レシピが削除されたら
   リンクだけ外し、材料行と `ref_recipe_title`（タイトルのスナップショット）は残す
   （features/recipe.md §3・data-model.md）
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


class Ingredient(SQLModel, table=True):
    __tablename__ = "ingredients"
    __table_args__ = (
        # 材料と親グループの recipe_id 一致を DB で保証する複合 FK。
        sa.ForeignKeyConstraint(
            ["group_id", "recipe_id"],
            ["ingredient_groups.id", "ingredient_groups.recipe_id"],
            name="fk_ingredients_group",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("group_id", "position", name="uq_ingredients_group_position"),
        # 数量は「入力するなら 0 より大きい」（features/recipe.md バリデーション表）。
        sa.CheckConstraint(
            "quantity IS NULL OR quantity > 0", name="ck_ingredients_quantity_positive"
        ),
        # 自己参照（編集中のレシピ自身をリンク先に指定）は不可。
        sa.CheckConstraint(
            "ref_recipe_id IS NULL OR ref_recipe_id <> recipe_id",
            name="ck_ingredients_no_self_reference",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    recipe_id: uuid.UUID = Field(
        foreign_key="recipes.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
    )

    # 親グループ。複合 FK（__table_args__）で参照するので、ここでは
    # foreign_key= を付けず素の UUID 列として宣言する。
    group_id: uuid.UUID = Field(nullable=False)

    name: str = Field(nullable=False)
    # 検索用の正規化済み材料名（app/text_normalize.normalize_search_text で生成）。
    name_normalized: str = Field(nullable=False, index=True)

    # 数量。任意（「少々」「適量」のように数量なしの材料がある）。
    # NUMERIC で持ち、小数（1.5 個など）も表せるようにする。
    quantity: Decimal | None = Field(
        default=None, sa_column=sa.Column(sa.Numeric(10, 3), nullable=True)
    )

    # 単位はマスター（`units`）に FK を張らず、入力された文字列をそのまま保存する
    # （features/unit.md §3「材料行の単位は文字列としてそのまま保存する」）。
    unit: str | None = Field(default=None, nullable=True)

    # 別レシピへのリンク。参照先削除で SET NULL（複合 FK ではなく単独 FK）。
    ref_recipe_id: uuid.UUID | None = Field(
        default=None,
        sa_column=sa.Column(
            sa.Uuid(),
            sa.ForeignKey("recipes.id", ondelete="SET NULL", name="fk_ingredients_ref_recipe"),
            nullable=True,
        ),
    )
    # リンク付き材料の「参照先タイトルのスナップショット」。保存時にサーバーが
    # 参照先レシピの現タイトルを記録する。参照先が消えても残る。
    ref_recipe_title: str | None = Field(default=None, nullable=True)

    # グループ内での表示順（1 起点の連番。サーバーが配列順から振る）。
    position: int = Field(nullable=False)
