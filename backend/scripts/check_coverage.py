"""カバレッジの下限を「行」と「分岐」で別々に判定する（Issue #76。testing.md §3）。

## なぜ自前のスクリプトが要るのか

pytest-cov（coverage.py）の `--cov-fail-under` は、行と分岐を**合わせた 1 つの値**
（合算）しか見ない。たとえば行 99% / 分岐 60% でも、合算が 85% を超えていれば通って
しまい、「分岐のテストが足りない」ことを見逃す。testing.md §3 は「行と分岐の両方で
ゲートする」と決めているので、`pytest --cov-report=json` が出す `coverage.json` の
合計値（`totals`）から、行と分岐をそれぞれ計算して下限と比べる。

標準ライブラリだけで書いてあり、依存パッケージは増やさない。

## 使い方（backend/ で）

    pytest --cov-report=json
    python -m scripts.check_coverage coverage.json --lines 85 --branches 75

## 終了コード

- 0: 行・分岐とも下限以上
- 1: どちらか（または両方）が下限を下回った（どれが何 % 足りないかを表示）
- 2: 使い方・入力の誤り（ファイルが無い・JSON が壊れている・必要な値が無い・値が
  おかしい・下限が 0〜100 の外）。「カバレッジが足りない」と区別するために分けている
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

# coverage.json の totals から読む 4 つの値。
_REQUIRED_KEYS = ("num_statements", "covered_lines", "num_branches", "covered_branches")

EXIT_OK = 0
EXIT_BELOW = 1
EXIT_USAGE = 2


class InputError(Exception):
    """入力（ファイル・JSON・引数）がおかしいときの例外。終了コード 2 にする。"""


def _threshold(text: str) -> float:
    """argparse 用: 下限は 0〜100 の数値（それ以外は使い方の誤り）。"""
    try:
        value = float(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"数値ではありません: {text}") from exc
    if not math.isfinite(value) or not 0 <= value <= 100:
        raise argparse.ArgumentTypeError(f"0〜100 の範囲で指定してください: {text}")
    return value


def _count(totals: dict[str, Any], key: str) -> int:
    """totals から件数を 1 つ読む。整数でない・負の値は入力の誤り。"""
    if key not in totals:
        raise InputError(f"coverage.json の totals に {key} がありません")
    value = totals[key]
    # bool は int の一種なので、明示的に弾く（True を 1 件と読まない）。
    if isinstance(value, bool) or not isinstance(value, int):
        raise InputError(f"{key} が整数ではありません: {value!r}")
    if value < 0:
        raise InputError(f"{key} が負の値です: {value}")
    return value


def _percent(covered: int, total: int, *, name: str) -> float:
    """割合（%）を返す。計測対象が 0 件なら 100% 扱い（対象が無いだけで失敗にしない）。"""
    if covered > total:
        raise InputError(f"{name}: カバーした数（{covered}）が総数（{total}）を超えています")
    if total == 0:
        return 100.0
    return 100.0 * covered / total


def load_totals(path: Path) -> tuple[float, float]:
    """coverage.json を読み、(行 %, 分岐 %) を返す。"""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise InputError(f"ファイルが見つかりません: {path}") from exc
    try:
        # NaN / Infinity は JSON の標準外。受け付けると割合の比較が壊れるので弾く。
        data = json.loads(text, parse_constant=_reject_constant)
    except json.JSONDecodeError as exc:
        raise InputError(f"JSON として読めません: {path}（{exc}）") from exc
    totals = data.get("totals") if isinstance(data, dict) else None
    if not isinstance(totals, dict):
        raise InputError("coverage.json に totals がありません")

    statements, lines, branches, covered_branches = (_count(totals, k) for k in _REQUIRED_KEYS)
    return (
        _percent(lines, statements, name="行"),
        _percent(covered_branches, branches, name="分岐"),
    )


def _reject_constant(name: str) -> float:
    raise InputError(f"数値として不正な値があります: {name}")


def main(argv: list[str] | None = None) -> int:
    # help 文字列は % 書式として扱われるので、% を表示したいときは %% と書く。
    parser = argparse.ArgumentParser(description="行・分岐カバレッジの下限を別々に判定する")
    parser.add_argument("coverage_json", type=Path, help="pytest --cov-report=json の出力")
    parser.add_argument("--lines", type=_threshold, required=True, help="行カバレッジの下限（%%）")
    parser.add_argument(
        "--branches", type=_threshold, required=True, help="分岐カバレッジの下限（%%）"
    )
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        # argparse は使い方の誤りで SystemExit(2) を投げる。そのまま 2 を返す。
        return EXIT_USAGE if exc.code else EXIT_OK

    try:
        line_pct, branch_pct = load_totals(args.coverage_json)
    except InputError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return EXIT_USAGE

    ok = True
    for name, actual, minimum in (
        ("行", line_pct, args.lines),
        ("分岐", branch_pct, args.branches),
    ):
        if actual >= minimum:
            print(f"OK  {name}カバレッジ {actual:.2f}%（下限 {minimum:.2f}%）")
        else:
            ok = False
            print(
                f"NG  {name}カバレッジ {actual:.2f}%（下限 {minimum:.2f}%、"
                f"{minimum - actual:.2f} ポイント不足）"
            )
    return EXIT_OK if ok else EXIT_BELOW


if __name__ == "__main__":
    sys.exit(main())
