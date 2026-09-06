"""seed units master (一般的な和食単位一式)

features/unit.md §4 の初期データを投入する。`大さじ` `小さじ` のみ
`placement = prefix`、他は `suffix`。`normalized` は
app/text_normalize.normalize_search_text で生成する（アプリの自動追加処理と
同じキーにするため）。

冪等: 既に同じ `normalized` があれば `ON CONFLICT DO NOTHING` で飛ばす
（このマイグレーションを空でない DB に流し直しても重複しない）。

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-06

"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from alembic import op
from app.text_normalize import normalize_search_text

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# features/unit.md §4 の例をそのまま採用。
_SUFFIX_UNITS = [
    "g",
    "ml",
    "cc",
    "個",
    "本",
    "枚",
    "束",
    "パック",
    "カップ",
    "合",
    "少々",
    "適量",
    "適宜",
    "ひとつまみ",
    "かけ",
    "片",
    "房",
    "缶",
    "袋",
    "玉",
]
_PREFIX_UNITS = ["大さじ", "小さじ"]


def _rows() -> list[dict[str, object]]:
    now = datetime.now(UTC)
    rows: list[dict[str, object]] = []
    for value in _SUFFIX_UNITS:
        rows.append({"value": value, "placement": "suffix", "created_at": now})
    for value in _PREFIX_UNITS:
        rows.append({"value": value, "placement": "prefix", "created_at": now})
    for row in rows:
        row["normalized"] = normalize_search_text(str(row["value"]))
    return rows


def upgrade() -> None:
    """初期単位を投入する（id は gen_random_uuid 相当をアプリ層に合わせ Python で生成）。"""
    units = sa.table(
        "units",
        sa.column("id", sa.Uuid()),
        sa.column("value", sa.String()),
        sa.column("normalized", sa.String()),
        sa.column("placement", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    for row in _rows():
        stmt = (
            pg_insert(units)
            .values(id=uuid.uuid4(), **row)
            .on_conflict_do_nothing(index_elements=["normalized"])
        )
        op.execute(stmt)


def downgrade() -> None:
    """このマイグレーションで入れた単位を正規化キーで削除する。"""
    normalized_keys = [r["normalized"] for r in _rows()]
    units = sa.table("units", sa.column("normalized", sa.String()))
    op.execute(units.delete().where(units.c.normalized.in_(normalized_keys)))
