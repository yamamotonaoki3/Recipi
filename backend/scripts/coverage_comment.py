"""PR に貼るカバレッジのコメント本文（Markdown）を作る（Issue #86。testing.md §3）。

CI（.github/workflows/backend.yml の `test` ジョブ）が pytest の後に呼び、
できた本文を `gh api` で PR にコメントする（同じコメントがあれば更新）。

- 全体の行・分岐カバレッジと下限、合否（✅ / ❌）。
- この PR で変わった `backend/app/` のファイルごとの行・分岐。
- 計算は scripts/check_coverage.py と同じ関数を使う（コメントの合否と CI の合否を
  必ず一致させる）。

標準ライブラリだけで書いてあり、依存パッケージは増やさない。

## 使い方（backend/ で）

    python -m scripts.coverage_comment coverage.json \\
        --changed-files changed-files.txt --lines 85 --branches 75 \\
        --output coverage-comment.md

`changed-files.txt` は 1 行 1 パス（リポジトリのルートからのパス。例
`backend/app/main.py`）。coverage.json が無い・壊れているときも、その旨を書いた
本文を出して終了コード 0 で終わる（コメントは補助なので CI を止めない）。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from scripts.check_coverage import (
    InputError,
    _threshold,
    load_coverage,
    meets,
    summary_percents,
)

# 同じコメントを見つけて更新するための目印（本文の先頭に置く）。
MARKER = "<!-- recipi-coverage:backend -->"

# リポジトリのルートからのパスのうち、backend のカバレッジ計測対象になるもの。
# coverage.json の files のキーは backend/ から見たパス（app/...）なので、
# 先頭の backend/ を外して突き合わせる。
_BACKEND_PREFIX = "backend/"
_MEASURED_PREFIX = "app/"


def _mark(ok: bool) -> str:
    return "✅" if ok else "❌"


def _fmt(value: float) -> str:
    return f"{value:.2f}%"


def _normalize(path: str) -> str:
    """区切りを / にそろえる（Windows で作った coverage.json にも対応）。"""
    return path.strip().replace("\\", "/")


def changed_measured_files(changed: list[str], files: dict[str, Any]) -> list[str]:
    """変更ファイルのうち、coverage.json で計測されている app/ 配下のパス（files のキー）を返す。

    計測されていない（files に無い）・実行できる行が 0 のファイルは出さない。
    """
    by_path = {_normalize(key): key for key in files}
    result: list[str] = []
    for raw in changed:
        path = _normalize(raw)
        if not path.startswith(_BACKEND_PREFIX):
            continue
        rel = path[len(_BACKEND_PREFIX) :]
        if not rel.startswith(_MEASURED_PREFIX) or rel not in by_path:
            continue
        entry = files[by_path[rel]]
        summary = entry.get("summary") if isinstance(entry, dict) else None
        if not isinstance(summary, dict) or summary.get("num_statements", 0) == 0:
            continue
        if rel not in result:
            result.append(rel)
    return sorted(result)


def build_body(data: dict[str, Any], changed: list[str], *, lines: float, branches: float) -> str:
    """coverage.json の中身と変更ファイルから、コメント本文を作る。"""
    totals = data.get("totals")
    if not isinstance(totals, dict):
        raise InputError("coverage.json に totals がありません")
    line_pct, branch_pct = summary_percents(totals)

    out = [
        MARKER,
        "### backend のカバレッジ",
        "",
        "| | 結果 | 下限 | 判定 |",
        "|---|---:|---:|:---:|",
        f"| 行 | {_fmt(line_pct)} | {_fmt(lines)} | {_mark(meets(line_pct, lines))} |",
        f"| 分岐 | {_fmt(branch_pct)} | {_fmt(branches)} | {_mark(meets(branch_pct, branches))} |",
        "",
        "#### この PR で変わったファイル",
        "",
    ]

    raw_files = data.get("files")
    files: dict[str, Any] = raw_files if isinstance(raw_files, dict) else {}
    targets = changed_measured_files(changed, files)
    if not targets:
        out.append("計測対象（`backend/app/`）のファイルに変更はありません。")
    else:
        out += ["| ファイル | 行 | 分岐 |", "|---|---:|---:|"]
        by_path = {_normalize(key): key for key in files}
        for rel in targets:
            summary = files[by_path[rel]]["summary"]
            f_line, f_branch = summary_percents(summary)
            out.append(
                f"| `{rel}` | {_fmt(f_line)}（{summary['covered_lines']}/"
                f"{summary['num_statements']}） | {_fmt(f_branch)}（"
                f"{summary['covered_branches']}/{summary['num_branches']}） |"
            )

    out += ["", "_CI を再実行すると、このコメントが更新されます。_", ""]
    return "\n".join(out)


def error_body(reason: str) -> str:
    """計測結果を読めなかったときの本文（コメントは出して、原因を見えるようにする）。"""
    return "\n".join(
        [
            MARKER,
            "### backend のカバレッジ",
            "",
            f"⚠️ カバレッジの結果を読めませんでした: {reason}",
            "",
            "テストの途中で失敗した可能性があります。CI のログを確認してください。",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PR に貼るカバレッジのコメント本文を作る")
    parser.add_argument("coverage_json", type=Path, help="pytest --cov-report=json の出力")
    parser.add_argument(
        "--changed-files", type=Path, required=True, help="変更ファイルの一覧（1 行 1 パス）"
    )
    parser.add_argument("--lines", type=_threshold, required=True, help="行カバレッジの下限（%%）")
    parser.add_argument(
        "--branches", type=_threshold, required=True, help="分岐カバレッジの下限（%%）"
    )
    parser.add_argument("--output", type=Path, required=True, help="本文の書き出し先")
    args = parser.parse_args(argv)

    try:
        changed = args.changed_files.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        changed = []

    try:
        body = build_body(
            load_coverage(args.coverage_json), changed, lines=args.lines, branches=args.branches
        )
    except InputError as exc:
        body = error_body(str(exc))

    args.output.write_text(body, encoding="utf-8")
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
