"""スキーマ共通の基底クラス。

Python の慣習は snake_case だが、api.md の JSON ボディは camelCase
（例: `displayName`, `refreshToken`）。`CamelModel` を継承すると、
フィールド名は Python 側で snake_case のまま書きつつ、JSON の
入出力だけ自動で camelCase に変換される。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )
