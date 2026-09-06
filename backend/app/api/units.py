"""`GET /api/v1/units` エンドポイント（features/unit.md §5）。

単位の入力候補（オートコンプリート用）を返す読み取り専用エンドポイント。
単位の登録専用 API は設けない。未登録単位の追加はレシピ保存時に
サーバーが自動 upsert する（app/services/recipe.py の `upsert_units`）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models.unit import Unit
from app.schemas.unit import UnitOption, UnitsResponse

router = APIRouter(prefix="/api/v1", tags=["units"])


@router.get("/units")
def list_units(session: Session = Depends(get_session)) -> UnitsResponse:
    # 表示は value のあいうえお順ではなく、まず prefix（大さじ / 小さじ）を
    # 先頭に寄せ、あとは登録順（created_at）にする。候補リストの見え方は
    # クライアントで調整するため、ここでは安定した順序を返せれば十分。
    units = session.exec(select(Unit).order_by(Unit.created_at, Unit.value)).all()  # type: ignore[arg-type]
    return UnitsResponse(units=[UnitOption(value=u.value, placement=u.placement) for u in units])
