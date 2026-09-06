"""`GET /units` のレスポンススキーマ（features/unit.md §5）。"""

from __future__ import annotations

from app.schemas.base import CamelModel


class UnitOption(CamelModel):
    value: str
    placement: str  # "suffix" / "prefix"


class UnitsResponse(CamelModel):
    units: list[UnitOption]
