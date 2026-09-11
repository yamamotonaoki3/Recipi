"""通知のリクエスト / レスポンススキーマ（features/notification.md §5・§6）。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import Field, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.models.notification import NotificationType
from app.schemas.base import CamelModel
from app.schemas.recipe import RecipeAuthor

# `POST /notifications/read` で一度に指定できる ID の上限。
MARK_READ_MAX_IDS = 100


class NotificationRecipe(CamelModel):
    """通知の遷移先レシピ（タイトルは本文の「『肉じゃが』を〜」に使う）。"""

    id: uuid.UUID
    title: str


class NotificationComment(CamelModel):
    """感想の通知で、どの感想かを指す（遷移先の特定用。本文は出さない）。"""

    id: uuid.UUID


class NotificationItem(CamelModel):
    id: uuid.UUID
    type: NotificationType
    # null = 未読。
    read_at: datetime | None
    # 「〇〇さんが〜しました」の〇〇。
    actor: RecipeAuthor
    # `followed` では null。
    recipe: NotificationRecipe | None
    # `recipe_commented` 以外では null。
    comment: NotificationComment | None
    created_at: datetime


class NotificationListResponse(CamelModel):
    items: list[NotificationItem]
    # 自分あての未読通知の数（一覧に出る通知と同じ条件で数える）。バッジ用。
    unread_count: int
    # カーソルページング（(created_at DESC, id DESC)）。次ページが無ければ null。
    next_cursor: str | None


class UnreadCountResponse(CamelModel):
    unread_count: int


class MarkReadRequest(CamelModel):
    """`POST /notifications/read` の body。

    - `ids` を送る → その ID のうち**自分あて**のものだけ既読にする（他人あて・存在しない
      ID は黙って無視する。notification.md §6）
    - `ids` を省略（`{}`、または body ごと省略）→ 自分の通知をすべて既読にする
    - `ids: null` は 400。全件既読は取り消せないので、明示の null を「全件」の意味に
      しない（送り間違いで全部既読になる事故を防ぐ）。null を型から隠すため
      `SkipJsonSchema[None]` を使う（OpenAPI 上は「任意だが null ではない」）
    """

    # 上限は list 側に付ける（None に長さの制約をかけると検証が壊れるため）。
    ids: Annotated[list[uuid.UUID], Field(max_length=MARK_READ_MAX_IDS)] | SkipJsonSchema[None] = (
        None
    )

    @model_validator(mode="after")
    def _reject_null_ids(self) -> Self:
        if "ids" in self.model_fields_set and self.ids is None:
            raise ValueError("ids に null は指定できません（全件既読は ids を省略してください）")
        return self
