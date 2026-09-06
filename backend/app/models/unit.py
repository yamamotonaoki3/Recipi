"""`units` テーブルに対応するモデル（材料の単位候補マスター）。

- 材料行の単位は文字列としてそのまま `ingredients.unit` に保存する。
  `units` は **入力候補（オートコンプリート）専用**のマスターで、全ユーザー共通。
- レシピ保存時、候補に無い単位を自由入力していたらサーバーが `units` に
  自動追加する（正規化キー `normalized` で重複排除。features/unit.md §3）。
- `placement` は表示位置（前置 / 後置）。シードで `大さじ` `小さじ` のみ
  `prefix`、他は `suffix`。ユーザー追加分は常に `suffix`。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Unit(SQLModel, table=True):
    __tablename__ = "units"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 表示用の値（最初に登録された形。例: "g" / "大さじ"）。
    value: str = Field(nullable=False)

    # 正規化キー（app/text_normalize.normalize_search_text で生成）。
    # "g" と全角 "ｇ"、"kg" と "Kg" はこのキーが一致するので 1 行にまとまる。
    # "g" と "グラム" のような別表記はキーが違うので別行として両方残る。
    normalized: str = Field(unique=True, nullable=False)

    # "suffix"（既定）/ "prefix"。表示整形はクライアント側で行う（API は
    # quantity / unit / placement を別々に返す。features/unit.md §3.1）。
    placement: str = Field(default="suffix", nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
