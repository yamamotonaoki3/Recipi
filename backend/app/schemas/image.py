"""`POST /images` のレスポンススキーマ（features/image.md §5）。"""

from __future__ import annotations

from pydantic import Field

from app.schemas.base import CamelModel


class ImageUploadResponse(CamelModel):
    """一時アップロードの結果。

    `key` はレシピ保存時に `thumbnailKey` / `steps[].imageKey` として送り返す
    ためのもの。`url` はアップロード直後のプレビュー表示に使う。
    """

    key: str = Field(description="オブジェクトキー。レシピ保存時にこの値を送る")
    url: str = Field(description="表示用 URL（プレビュー用）")
