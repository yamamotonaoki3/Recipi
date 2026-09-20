"""クライアント公開設定API（Issue #230）。"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import settings
from app.schemas.client_config import ClientConfigResponse

router = APIRouter(prefix="/api/v1", tags=["client-config"])


@router.get("/client-config")
def get_client_config() -> ClientConfigResponse:
    """画像選択に必要な公開設定だけを返す（認証・DBアクセス不要）。"""
    return ClientConfigResponse(image_max_dimension=settings.IMAGE_MAX_DIMENSION)
