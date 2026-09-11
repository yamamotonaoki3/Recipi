"""感想（コメント）のリクエスト / レスポンススキーマ（features/comment.md §5・§6）。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Self

from pydantic import field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.models.recipe_comment import COMMENT_BODY_MAX_LENGTH
from app.schemas.base import CamelModel
from app.schemas.recipe import RecipeAuthor


def _strip_and_check_body(value: str) -> str:
    """本文は前後の空白を除いてから 1〜1000 文字で検証し、除いた値を保存する。

    生の長さで `min_length` / `max_length` を見ると、空白だけの本文（" "）が通り、
    前後に空白を付けた 1000 文字が 1001 文字として弾かれてしまう（comment.md §6
    「前後空白トリム」）。
    """
    stripped = value.strip()
    if not stripped:
        raise ValueError("感想の本文を入力してください（空白だけにはできません）")
    if len(stripped) > COMMENT_BODY_MAX_LENGTH:
        raise ValueError(f"感想の本文は {COMMENT_BODY_MAX_LENGTH} 文字までです")
    return stripped


def _blank_key_to_none(value: object) -> object:
    """画像キーの空文字・空白だけは「画像なし（null）」として扱う。"""
    if isinstance(value, str) and not value.strip():
        return None
    return value


class CommentCreateRequest(CamelModel):
    """`POST /recipes/{id}/comments` の body。本文は必須、画像は任意。"""

    body: str
    # `POST /images` で一時アップロードして得たキー（features/image.md §3）。
    image_key: str | None = None

    _check_body = field_validator("body")(_strip_and_check_body)
    _normalize_key = field_validator("image_key", mode="before")(_blank_key_to_none)


class CommentUpdateRequest(CamelModel):
    """`PATCH /comments/{id}` の body。**送られた項目だけ**を変える。

    - `body`: 送られたら 1〜1000 文字で検証して置き換える。**null は送れない**
      （本文は必須の列）。OpenAPI 上も「任意だが null ではない」にするため、
      null を型から隠す `SkipJsonSchema[None]` を使う。`str | None` のままだと、
      生成される frontend の型が `body: null` を許してしまい、実際には 400 になる
      という契約の食い違いが起きる
    - `image_key`: 省略 = 変更なし / 今と同じキー = 維持 / null = 削除 /
      新しいキー = 差し替え（image.md §3）。null に意味があるので nullable
    - どちらも送られていない `{}` は 400
    """

    body: str | SkipJsonSchema[None] = None
    image_key: str | None = None

    @field_validator("body")
    @classmethod
    def _check_body(cls, value: str | None) -> str | None:
        return None if value is None else _strip_and_check_body(value)

    _normalize_key = field_validator("image_key", mode="before")(_blank_key_to_none)

    @model_validator(mode="after")
    def _require_a_change(self) -> Self:
        sent = self.model_fields_set
        if not sent & {"body", "image_key"}:
            raise ValueError("body か imageKey の少なくとも一方を指定してください")
        if "body" in sent and self.body is None:
            raise ValueError("body に null は指定できません")
        return self


class CommentResponse(CamelModel):
    """感想 1 件（features/comment.md §5）。

    `imageUrl` と `author.avatarUrl` は、保存したオブジェクトキーから組み立てる
    表示用の派生値（features/image.md §4）。
    """

    id: uuid.UUID
    body: str
    image_url: str | None
    author: RecipeAuthor
    created_at: datetime
    updated_at: datetime


class CommentListResponse(CamelModel):
    items: list[CommentResponse]
    # カーソルページング（(created_at DESC, id DESC)）。次ページが無ければ null。
    next_cursor: str | None
