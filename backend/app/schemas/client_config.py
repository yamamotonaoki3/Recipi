"""認証なしでクライアントへ公開する設定（Issue #230）。"""

from __future__ import annotations

from app.schemas.base import CamelModel


class ClientConfigResponse(CamelModel):
    """クライアントのローカル処理に必要な、安全な設定だけを返す。"""

    image_max_dimension: int
