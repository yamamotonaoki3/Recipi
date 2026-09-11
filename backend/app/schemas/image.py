"""画像まわりのレスポンススキーマ（features/image.md §5）。

`POST /images`（一時アップロード）と `PUT /users/me/avatar`（アバター）。
"""

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


class AvatarResponse(CamelModel):
    """`PUT /users/me/avatar` の結果（features/image.md §5）。

    アバターは専用エンドポイントで保存まで完結するので、キーは返さない
    （クライアントがキーを送り返す場面が無い）。表示用 URL だけを返す。
    """

    avatar_url: str = Field(description="設定したアバターの表示用 URL")
