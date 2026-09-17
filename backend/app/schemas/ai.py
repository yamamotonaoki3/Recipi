"""AI 校正 API の入出力スキーマ。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

ProofreadKind = Literal["title", "description", "step", "ingredient", "ingredient_group"]


class ProofreadItem(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: ProofreadKind
    text: str = Field(max_length=2_000)


class ProofreadRequest(BaseModel):
    items: list[ProofreadItem] = Field(max_length=200)

    @field_validator("items")
    @classmethod
    def validate_items_not_empty(cls, value: list[ProofreadItem]) -> list[ProofreadItem]:
        if not value:
            raise ValueError("items は1件以上指定してください")
        return value

    @model_validator(mode="after")
    def validate_total_text_length(self) -> ProofreadRequest:
        ids = [item.id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("items.id は重複できません")
        if sum(len(item.text) for item in self.items) > 8_000:
            raise ValueError("text の合計は8000文字以内にしてください")
        return self


class ProofreadSuggestion(BaseModel):
    id: str
    original: str
    corrected: str
    changed: bool = True
    note: str | None = None


class ProofreadResponse(BaseModel):
    suggestions: list[ProofreadSuggestion]
