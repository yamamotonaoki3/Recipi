"""`steps` テーブルに対応するモデル。

手順は材料と違いグループ化しない。フラットな番号付きリスト（`position` は
1 起点の連番）。各手順は本文 ＋ その手順の画像 1 枚（任意）を持つ
（features/recipe.md §2・§4）。
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


class Step(SQLModel, table=True):
    __tablename__ = "steps"
    __table_args__ = (
        sa.UniqueConstraint("recipe_id", "position", name="uq_steps_recipe_position"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    recipe_id: uuid.UUID = Field(
        foreign_key="recipes.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
    )

    # 手順番号（1 起点の連番。サーバーが配列順から振る）。
    position: int = Field(nullable=False)

    body: str = Field(nullable=False)

    # その手順の画像のオブジェクトキー（任意）。表示 URL はレスポンス生成時に組む。
    image_key: str | None = Field(default=None, nullable=True)
