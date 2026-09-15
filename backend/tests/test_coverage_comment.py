"""scripts/coverage_comment.py と check_coverage の共通関数の単体テスト（Issue #86）。

DB・ストレージ・ネットワークは使わない。

BB: 全体の合否（ちょうど下限は ✅、下回ると ❌）、変更ファイルの表示、変更なしの表示、
先頭に目印が入る。
WB: backend/ 以外・app/ 以外・計測されていない・実行行 0 のファイルは出さない、
Windows の区切り、coverage.json が無い / 壊れている / totals が無いときの本文。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scripts.check_coverage import meets, summary_percents
from scripts.coverage_comment import MARKER, build_body, changed_measured_files, main


def _summary(lines: int, statements: int, cb: int, branches: int) -> dict[str, int]:
    return {
        "num_statements": statements,
        "covered_lines": lines,
        "num_branches": branches,
        "covered_branches": cb,
    }


def _data(**files: dict[str, int]) -> dict[str, Any]:
    return {
        "totals": _summary(90, 100, 80, 100),
        "files": {path: {"summary": s} for path, s in files.items()},
    }


# --- 共通関数（check_coverage） ------------------------------------------


def test_summary_percents_は行と分岐を別々に計算する() -> None:
    assert summary_percents(_summary(9, 10, 1, 4)) == (90.0, 25.0)


def test_summary_percents_は分岐0件を100パーセント扱いにする() -> None:
    assert summary_percents(_summary(0, 0, 0, 0)) == (100.0, 100.0)


def test_meets_はちょうど下限を合格にする() -> None:
    assert meets(85.0, 85.0)
    assert not meets(84.99, 85.0)


# --- 本文 ------------------------------------------------------------------


def test_本文の先頭に目印があり全体の合否が出る() -> None:
    body = build_body(_data(), [], lines=85, branches=75)
    assert body.splitlines()[0] == MARKER
    assert "| 行 | 90.00% | 85.00% | ✅ |" in body
    assert "| 分岐 | 80.00% | 75.00% | ✅ |" in body
    assert "ファイルに変更はありません" in body


def test_下限を下回ると判定がバツになる() -> None:
    body = build_body(_data(), [], lines=90.01, branches=80)
    assert "| 行 | 90.00% | 90.01% | ❌ |" in body
    assert "| 分岐 | 80.00% | 80.00% | ✅ |" in body


def test_変更したファイルの行と分岐が出る() -> None:
    data = _data(**{"app/main.py": _summary(9, 10, 1, 2)})
    body = build_body(data, ["backend/app/main.py"], lines=85, branches=75)
    assert "| `app/main.py` | 90.00%（9/10） | 50.00%（1/2） |" in body


def test_対象外のファイルは出さない() -> None:
    files = {
        "app/main.py": {"summary": _summary(9, 10, 1, 2)},
        "app/empty.py": {"summary": _summary(0, 0, 0, 0)},
    }
    changed = [
        "docs/README.md",  # backend/ 以外
        "backend/tests/test_x.py",  # app/ 以外
        "backend/app/not_measured.py",  # coverage.json に無い
        "backend/app/empty.py",  # 実行行が 0
        "backend/app/main.py",
        "backend/app/main.py",  # 重複
    ]
    assert changed_measured_files(changed, files) == ["app/main.py"]


def test_Windowsの区切りのキーでも突き合わせる() -> None:
    files = {"app\\api\\x.py": {"summary": _summary(1, 1, 0, 0)}}
    assert changed_measured_files(["backend/app/api/x.py"], files) == ["app/api/x.py"]
    body = build_body(
        {"totals": _summary(1, 1, 0, 0), "files": files},
        ["backend/app/api/x.py"],
        lines=85,
        branches=75,
    )
    assert "`app/api/x.py`" in body


# --- main（ファイルの読み書き） ---------------------------------------------


def _run(tmp_path: Path, coverage: str | None, changed: str | None = "") -> str:
    cov = tmp_path / "coverage.json"
    if coverage is not None:
        cov.write_text(coverage, encoding="utf-8")
    changed_path = tmp_path / "changed.txt"
    if changed is not None:
        changed_path.write_text(changed, encoding="utf-8")
    out = tmp_path / "comment.md"
    code = main(
        [
            str(cov),
            "--changed-files",
            str(changed_path),
            "--lines",
            "85",
            "--branches",
            "75",
            "--output",
            str(out),
        ]
    )
    assert code == 0
    return out.read_text(encoding="utf-8")


def test_mainは本文をファイルに書く(tmp_path: Path) -> None:
    data = _data(**{"app/main.py": _summary(9, 10, 1, 2)})
    body = _run(tmp_path, json.dumps(data), "backend/app/main.py\n")
    assert body.startswith(MARKER)
    assert "`app/main.py`" in body


def test_変更一覧が無くても本文を出す(tmp_path: Path) -> None:
    body = _run(tmp_path, json.dumps(_data()), None)
    assert "ファイルに変更はありません" in body


def test_coverage_jsonが無いときは読めない旨の本文(tmp_path: Path) -> None:
    body = _run(tmp_path, None)
    assert body.startswith(MARKER)
    assert "読めませんでした" in body


def test_壊れたJSONのときは読めない旨の本文(tmp_path: Path) -> None:
    assert "読めませんでした" in _run(tmp_path, "{broken")


def test_totalsが無いときは読めない旨の本文(tmp_path: Path) -> None:
    assert "読めませんでした" in _run(tmp_path, json.dumps({"files": {}}))
