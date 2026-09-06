"""add recipe tables (recipes, ingredient_groups, ingredients, steps, units)

Issue #37（Phase 2 レシピ CRUD ＋ 単位）用のテーブルを追加する。

DB レベルの制約が正（data-model.md）:
- 複合 FK `(group_id, recipe_id)` → `ingredient_groups(id, recipe_id)`
  （材料と親グループの recipe_id 一致を保証。PostgreSQL の CHECK は
  他テーブルを見られないため複合 FK で担保する）
- CHECK: servings 1〜99 / quantity > 0 / `ref_recipe_id <> recipe_id` /
  カウント列 >= 0
- UNIQUE: position 系（レシピ内グループ順・グループ内材料順・レシピ内手順順）
- `ingredients.ref_recipe_id` は ON DELETE SET NULL（他は CASCADE）

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """`recipes` / `ingredient_groups` / `ingredients` / `steps` / `units` を作成する。

    UUID の既定値は Postgres の拡張に頼らずアプリ側（uuid4）で発行するため、
    SERVER DEFAULT は付けない（既存の auth テーブルと同じ方針）。
    """
    # --- units（他テーブルに依存しない独立マスター） ---------------------
    op.create_table(
        "units",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("normalized", sa.String(), nullable=False),
        sa.Column("placement", sa.String(), nullable=False, server_default=sa.text("'suffix'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_units_normalized", "units", ["normalized"], unique=True)

    # --- recipes -------------------------------------------------------
    op.create_table(
        "recipes",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("title_normalized", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False, server_default=sa.text("''")),
        sa.Column("servings", sa.Integer(), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("thumbnail_key", sa.String(), nullable=True),
        sa.Column("favorite_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("comment_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("servings >= 1 AND servings <= 99", name="ck_recipes_servings_range"),
        sa.CheckConstraint("favorite_count >= 0", name="ck_recipes_favorite_count_non_negative"),
        sa.CheckConstraint("comment_count >= 0", name="ck_recipes_comment_count_non_negative"),
    )
    op.create_index("ix_recipes_user_id", "recipes", ["user_id"])
    op.create_index("ix_recipes_title_normalized", "recipes", ["title_normalized"])
    op.create_index("ix_recipes_is_public_created_at", "recipes", ["is_public", "created_at"])

    # --- ingredient_groups -------------------------------------------
    op.create_table(
        "ingredient_groups",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("recipe_id", "position", name="uq_ingredient_groups_recipe_position"),
        # ↓ ingredients からの複合 FK の参照先。
        sa.UniqueConstraint("id", "recipe_id", name="uq_ingredient_groups_id_recipe"),
    )
    op.create_index("ix_ingredient_groups_recipe_id", "ingredient_groups", ["recipe_id"])

    # --- ingredients ------------------------------------------------
    op.create_table(
        "ingredients",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("group_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("name_normalized", sa.String(), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=True),
        sa.Column("unit", sa.String(), nullable=True),
        sa.Column("ref_recipe_id", pg.UUID(as_uuid=True), nullable=True),
        sa.Column("ref_recipe_title", sa.String(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["group_id", "recipe_id"],
            ["ingredient_groups.id", "ingredient_groups.recipe_id"],
            name="fk_ingredients_group",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["ref_recipe_id"],
            ["recipes.id"],
            name="fk_ingredients_ref_recipe",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("group_id", "position", name="uq_ingredients_group_position"),
        sa.CheckConstraint(
            "quantity IS NULL OR quantity > 0", name="ck_ingredients_quantity_positive"
        ),
        sa.CheckConstraint(
            "ref_recipe_id IS NULL OR ref_recipe_id <> recipe_id",
            name="ck_ingredients_no_self_reference",
        ),
    )
    op.create_index("ix_ingredients_recipe_id", "ingredients", ["recipe_id"])
    op.create_index("ix_ingredients_name_normalized", "ingredients", ["name_normalized"])
    op.create_index("ix_ingredients_ref_recipe_id", "ingredients", ["ref_recipe_id"])

    # --- steps -----------------------------------------------------
    op.create_table(
        "steps",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "recipe_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("body", sa.String(), nullable=False),
        sa.Column("image_key", sa.String(), nullable=True),
        sa.UniqueConstraint("recipe_id", "position", name="uq_steps_recipe_position"),
    )
    op.create_index("ix_steps_recipe_id", "steps", ["recipe_id"])


def downgrade() -> None:
    """upgrade で作ったテーブルを FK 依存の逆順で削除する。"""
    op.drop_table("steps")
    op.drop_table("ingredients")
    op.drop_table("ingredient_groups")
    op.drop_table("recipes")
    op.drop_table("units")
