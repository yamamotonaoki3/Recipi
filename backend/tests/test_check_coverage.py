"""scripts/check_coverage.py の単体テスト（Issue #76）。DB・ストレージは使わない。

BB: 行・分岐それぞれの境界（ちょうど下限は合格、0.01 下回ると不合格）、
片方だけ不足、計測対象 0 件は 100% 扱い。
WB: 入力の誤り（ファイルが無い・壊れた JSON・totals / 必須キーの欠落・型の誤り・
負の値・カバー数が総数超え・NaN・下限が範囲外）はすべて終了コード 2。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from scripts.check_coverage import EXIT_BELOW, EXIT_OK, EXIT_USAGE, main


def _write(tmp_path: Path, totals: Any) -> Path:
    path = tmp_path / "coverage.json"
    path.write_text(json.dumps({"totals": totals}), encoding="utf-8")
    return path


def _totals(
    lines: int = 9000, statements: int = 10000, branches_covered: int = 800, branches: int = 1000
) -> dict[str, int]:
    return {
        "num_statements": statements,
        "covered_lines": lines,
        "num_branches": branches,
        "covered_branches": branches_covered,
    }


def _run(path: Path, lines: str = "85", branches: str = "75") -> int:
    return main([str(path), "--lines", lines, "--branches", branches])


def test_both_above_minimum_passes(tmp_path: Path) -> None:
    assert _run(_write(tmp_path, _totals())) == EXIT_OK


@pytest.mark.parametrize(
    ("lines", "branches_covered", "expected"),
    [
        (8500, 800, EXIT_OK),  # 行ちょうど 85.00% は合格
        (8499, 800, EXIT_BELOW),  # 行 84.99% は不合格
        (9000, 750, EXIT_OK),  # 分岐ちょうど 75.00% は合格
        (9000, 749, EXIT_BELOW),  # 分岐 74.90% は不合格
    ],
)
def test_boundaries(tmp_path: Path, lines: int, branches_covered: int, expected: int) -> None:
    totals = _totals(lines=lines, branches_covered=branches_covered)
    assert _run(_write(tmp_path, totals)) == expected


def test_branch_boundary_at_two_decimals(tmp_path: Path) -> None:
    """分岐 74.99% も不合格（下限との差が 0.01 でも落とす）。"""
    totals = _totals(branches_covered=7499, branches=10000)
    assert _run(_write(tmp_path, totals)) == EXIT_BELOW


def test_only_lines_below_fails_and_says_which(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(_write(tmp_path, _totals(lines=8000))) == EXIT_BELOW
    out = capsys.readouterr().out
    assert "NG  行カバレッジ 80.00%" in out
    assert "OK  分岐カバレッジ" in out


def test_only_branches_below_fails_and_says_which(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(_write(tmp_path, _totals(branches_covered=500))) == EXIT_BELOW
    out = capsys.readouterr().out
    assert "OK  行カバレッジ" in out
    assert "NG  分岐カバレッジ 50.00%" in out


@pytest.mark.parametrize(
    "totals",
    [
        _totals(lines=0, statements=0),  # 行の計測対象が 0 件
        _totals(branches_covered=0, branches=0),  # 分岐の計測対象が 0 件
    ],
)
def test_zero_targets_count_as_full(tmp_path: Path, totals: dict[str, int]) -> None:
    assert _run(_write(tmp_path, totals)) == EXIT_OK


def test_missing_file_is_usage_error(tmp_path: Path) -> None:
    assert _run(tmp_path / "nope.json") == EXIT_USAGE


def test_broken_json_is_usage_error(tmp_path: Path) -> None:
    path = tmp_path / "coverage.json"
    path.write_text("{not json", encoding="utf-8")
    assert _run(path) == EXIT_USAGE


def test_missing_totals_is_usage_error(tmp_path: Path) -> None:
    path = tmp_path / "coverage.json"
    path.write_text(json.dumps({"files": {}}), encoding="utf-8")
    assert _run(path) == EXIT_USAGE


@pytest.mark.parametrize(
    "key", ["num_statements", "covered_lines", "num_branches", "covered_branches"]
)
def test_each_missing_key_is_usage_error(tmp_path: Path, key: str) -> None:
    totals: dict[str, Any] = _totals()
    del totals[key]
    assert _run(_write(tmp_path, totals)) == EXIT_USAGE


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("covered_lines", "9000"),  # 文字列
        ("num_branches", True),  # bool は件数として読まない
        ("covered_lines", 12.5),  # 小数
        ("num_statements", -1),  # 負の値
    ],
)
def test_bad_values_are_usage_errors(tmp_path: Path, key: str, value: Any) -> None:
    totals: dict[str, Any] = _totals()
    totals[key] = value
    assert _run(_write(tmp_path, totals)) == EXIT_USAGE


def test_covered_more_than_total_is_usage_error(tmp_path: Path) -> None:
    assert _run(_write(tmp_path, _totals(lines=10001))) == EXIT_USAGE


def test_nan_is_usage_error(tmp_path: Path) -> None:
    path = tmp_path / "coverage.json"
    path.write_text(
        '{"totals": {"num_statements": NaN, "covered_lines": 1, '
        '"num_branches": 1, "covered_branches": 1}}',
        encoding="utf-8",
    )
    assert _run(path) == EXIT_USAGE


@pytest.mark.parametrize(
    ("lines", "branches"), [("101", "75"), ("-1", "75"), ("85", "abc"), ("nan", "75")]
)
def test_out_of_range_thresholds_are_usage_errors(
    tmp_path: Path, lines: str, branches: str
) -> None:
    assert _run(_write(tmp_path, _totals()), lines=lines, branches=branches) == EXIT_USAGE
