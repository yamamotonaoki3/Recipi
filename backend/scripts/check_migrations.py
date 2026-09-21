"""マイグレーションの健全性を CI で検査する（Issue #255）。

使い方（backend/ で実行。DB に接続する）:
    python -m scripts.check_migrations

## 何を検査するか

### 1. head が 1 つであること

2 つのマイグレーションが同じ親（`down_revision`）を指すと head が分岐し、
`alembic upgrade head` が `Multiple head revisions` で失敗する（Issue #199 で実際に発生）。
分岐しても**ローカルでは気づけない**（既に適用済みの DB では upgrade が走らないため）。
気づくのは本番デプロイのときになる。ここで落としておく。

### 2. モデルに有るテーブル・列が、マイグレーションにも有ること

SQLModel のモデルを変えたのにマイグレーションを書き忘れると、テスト DB は
`alembic upgrade head` で作られるためモデル側の変更が反映されず、実行時に初めて壊れる。

## 検査対象

モデルと既存 DB のテーブル・列だけでなく、型・索引・制約の差分も検査する。
モデル側の日時列は `DateTime(timezone=True)`、一意性と索引は既存マイグレーションと
同じ名前・形にそろえているため、`alembic check` は差分ゼロになる。
"""

from __future__ import annotations

import os
import sys

# 設定の必須項目が無くても import できるようにする（export_openapi.py と同じ方針）。
os.environ.setdefault("APP_ENV", "test")

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

import app.models  # noqa: F401,E402  モデルを metadata に登録する
from app.db import engine  # noqa: E402

# モデルと既存 DB の構造差分をすべて検査する。
_WATCHED = frozenset(
    {
        "add_table",
        "remove_table",
        "add_column",
        "remove_column",
        "modify_type",
        "add_index",
        "remove_index",
        "add_constraint",
        "remove_constraint",
    }
)

# alembic 自身が作る管理テーブル。モデルには存在しないので、差分として報告させない。
_IGNORED_TABLES = frozenset({"alembic_version"})


def _table_name_of(diff: tuple[object, ...]) -> str | None:
    """差分タプルからテーブル名を取り出す（取れなければ None）。"""
    kind = diff[0]
    if kind in ("add_table", "remove_table"):
        return str(getattr(diff[1], "name", ""))
    if kind in ("add_column", "remove_column"):
        # ("add_column", schema, table_name, Column)
        return str(diff[2])
    if kind == "modify_type":
        return str(diff[2])
    if kind in ("add_index", "remove_index"):
        return str(getattr(getattr(diff[1], "table", None), "name", ""))
    if kind in ("add_constraint", "remove_constraint"):
        return str(getattr(getattr(diff[1], "table", None), "name", ""))
    return None


def check_single_head() -> list[str]:
    """head が 1 つでなければ、その説明を返す。"""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    heads = script.get_heads()
    if len(heads) <= 1:
        return []
    return [
        f"マイグレーションの head が {len(heads)} 個に分岐しています: {', '.join(sorted(heads))}",
        "  同じ `down_revision` を指すマイグレーションが複数あります。",
        "  後から足した方の `down_revision` を、もう一方の revision に付け替えてください。",
        "  （このまま本番へデプロイすると `alembic upgrade head` が",
        "    Multiple head revisions で失敗します）",
    ]


def check_model_drift() -> list[str]:
    """モデルに有ってマイグレーションに無いテーブル・列（およびその逆）を返す。"""
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True},
        )
        diffs = compare_metadata(context, SQLModel.metadata)

    problems: list[str] = []
    for diff in diffs:
        # 1 つの列に対する変更は、タプルのリストに包まれて来ることがある。
        entries = diff if isinstance(diff, list) else [diff]
        for entry in entries:
            if not isinstance(entry, tuple) or not entry:
                continue
            kind = entry[0]
            if kind not in _WATCHED:
                continue
            table = _table_name_of(entry)
            if table in _IGNORED_TABLES:
                continue
            if kind == "add_table":
                problems.append(
                    f"モデルにあるテーブル '{table}' を作るマイグレーションがありません"
                )
            elif kind == "remove_table":
                problems.append(f"DB にあるテーブル '{table}' に対応するモデルがありません")
            elif kind == "add_column":
                column = getattr(entry[3], "name", "?")
                problems.append(
                    f"モデルにある列 '{table}.{column}' を追加するマイグレーションがありません"
                )
            elif kind == "remove_column":
                column = getattr(entry[3], "name", "?")
                problems.append(
                    f"DB にある列 '{table}.{column}' に対応するモデルの定義がありません"
                )
            elif kind == "modify_type":
                problems.append(f"列 '{table}.{entry[3]}' の型がモデルとDBで一致しません")
            elif kind in {"add_index", "remove_index"}:
                index = getattr(entry[1], "name", "?")
                problems.append(f"索引 '{table}.{index}' がモデルとDBで一致しません")
            elif kind in {"add_constraint", "remove_constraint"}:
                constraint = getattr(entry[1], "name", "?")
                problems.append(f"制約 '{table}.{constraint}' がモデルとDBで一致しません")

    if problems:
        problems.append(
            '  `alembic revision --autogenerate -m "<説明>"` でマイグレーションを作り、'
        )
        problems.append("  生成された内容を確認してからコミットしてください。")
    return problems


def main() -> int:
    failures = check_single_head() + check_model_drift()
    if failures:
        print("マイグレーションの検査に失敗しました:", file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
        return 1
    print("OK  head は 1 つ / モデルとマイグレーションのテーブル・列は一致しています")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
