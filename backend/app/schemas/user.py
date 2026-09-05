"""`/users/*` エンドポイントのリクエスト/レスポンススキーマ。"""

from __future__ import annotations

import uuid

from pydantic import Field

from app.schemas.base import CamelModel


class UpdateMeRequest(CamelModel):
    # Phase 1 スコープは displayName のみ（profile.md の他フィールドは対象外）。
    display_name: str = Field(min_length=1, max_length=30)


class UserMeResponse(CamelModel):
    id: uuid.UUID
    email: str
    display_name: str
