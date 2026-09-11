"""`/users/*` エンドポイントのリクエスト/レスポンススキーマ。"""

from __future__ import annotations

import re
import uuid
from typing import Self

from pydantic import Field, field_validator, model_validator

from app.schemas.base import CamelModel

# 表示名・URL の上限（features/profile.md §6）。URL の上限は DB の列長
# （VARCHAR(2048)。alembic a7b8c9d0e1f2）と同じ値にそろえる。
DISPLAY_NAME_MAX_LENGTH = 30
URL_MAX_LENGTH = 2048

# URL は `http://` か `https://` で始まり、空白を含まないものだけを受け付ける。
# ドメインの許可リストは採らない（todo.md #14 を「形式チェックのみ」で確定）。
_URL_PATTERN = re.compile(r"^https?://\S+$")

# null を送ることを許さない項目（DB では NOT NULL の列）。
# URL は「null = 削除」なので含めない。
_NON_NULLABLE_FIELDS = (
    "display_name",
    "email_public",
    "x_public",
    "instagram_public",
    "other_public",
)


class UpdateMeRequest(CamelModel):
    """`PATCH /users/me` の body（features/profile.md §5）。

    ## 「送られた項目だけ更新する」の作り方

    すべての項目を任意にし、**既定値を `None` にする**。Pydantic v2 では
    `str | None` と書くだけだと「null も入れられる必須項目」になってしまい、
    表示名だけ送る、といった部分更新ができない。

    そのうえで、「送られなかった」と「null が送られた」を区別する必要がある
    （どちらも値は `None` になる）。区別には Pydantic が記録している
    `model_fields_set`（＝リクエストに実際に含まれていた項目名）を使う。
    - 送られなかった → 変更しない
    - URL に null → 削除する
    - 表示名・トグルに null → 400（DB では NOT NULL の列なので、ここで弾く）
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=DISPLAY_NAME_MAX_LENGTH)
    x_url: str | None = Field(default=None, max_length=URL_MAX_LENGTH)
    instagram_url: str | None = Field(default=None, max_length=URL_MAX_LENGTH)
    other_url: str | None = Field(default=None, max_length=URL_MAX_LENGTH)
    email_public: bool | None = None
    x_public: bool | None = None
    instagram_public: bool | None = None
    other_public: bool | None = None

    @field_validator("display_name")
    @classmethod
    def _reject_blank_display_name(cls, value: str | None) -> str | None:
        """空白だけ（半角・全角とも）の表示名を拒否する。

        `min_length=1` は " " や全角の "　" を通してしまうため、前後の空白を
        除いた値で確かめる（レシピ名の `_reject_blank` と同じ考え方。Codex #37）。
        """
        if value is not None and not value.strip():
            raise ValueError("表示名は空白だけにはできません")
        return value

    @field_validator("x_url", "instagram_url", "other_url", mode="before")
    @classmethod
    def _blank_url_to_none(cls, value: object) -> object:
        """空文字・空白だけの URL は「未設定（null）」として扱う（profile.md §6）。

        前後の空白は取り除いてから、下の形式チェックに渡す。
        """
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("x_url", "instagram_url", "other_url")
    @classmethod
    def _validate_url(cls, value: str | None) -> str | None:
        if value is not None and not _URL_PATTERN.match(value):
            raise ValueError("URL は http:// または https:// で始めてください")
        return value

    @model_validator(mode="after")
    def _reject_null_for_required_columns(self) -> Self:
        """NOT NULL の列に null が送られたら 400 にする。

        ここで弾かずに ORM に `None` を代入すると、commit 時に DB の NOT NULL
        違反で 500 になる。検証の段階で落とすので、**1 項目でも不正なら何も
        書き換わらない**（部分的に反映されることはない）。
        """
        for name in _NON_NULLABLE_FIELDS:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} に null は指定できません")
        return self


class UserMeResponse(CamelModel):
    """本人のプロフィール設定（`PATCH /users/me` の応答）。

    id / email / displayName は Phase 1 からある項目で、frontend が名前で
    参照している（`features/auth/api.ts`）。**名前と既存の項目は変えずに**
    プロフィール拡張の項目を足している。
    """

    id: uuid.UUID
    email: str
    display_name: str
    avatar_url: str | None
    email_public: bool
    x_url: str | None
    x_public: bool
    instagram_url: str | None
    instagram_public: bool
    other_url: str | None
    other_public: bool
