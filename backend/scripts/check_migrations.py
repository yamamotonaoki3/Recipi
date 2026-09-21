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

## なぜ `alembic check` をそのまま使わないか

`alembic check` は**型・索引・制約の差分も全て**報告する。このリポジトリでは、それが
**既存の 35 件の差分**に埋もれて使い物にならない（Issue #255 で計測）。内訳:

- 26 件: DB は `TIMESTAMP(timezone=True)` だが、モデル側が `timezone=True` を宣言して
  いないため `DateTime()` と見なされる。`datetime` 列を持つモデル 15 ファイルのうち、
  宣言しているのは 2 箇所だけ。
- 9 件: `Field(unique=True, index=True)` が作るメタデータと、手書きマイグレーションの
  UniqueConstraint / 索引名の表現差。

どちらも現時点で実害は無い（テーブルは必ず alembic 経由で作るため）。根本修正は別 Issue。
そのためここでは **`add_table` / `remove_table` / `add_column` / `remove_column` だけ**を見る。
「モデルを変えたのにマイグレーションを書き忘れた」という本命のミスはこれで捕まる。

型・索引・制約の差分を検査対象に戻すのは、上記の根本修正が終わってから。
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

# 「テーブル・列が有るか無いか」だけを見る。型・索引・制約の差分は上のコメントの理由で見ない。
_WATCHED = frozenset({"add_table", "remove_table", "add_column", "remove_column"})

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
            # 型の差分は見ない（モジュール冒頭のコメントの理由）。
            opts={"compare_type": False},
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
