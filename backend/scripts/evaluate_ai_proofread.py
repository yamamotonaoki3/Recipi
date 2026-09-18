"""Ollama 実モデルの校正品質を固定ケースで測定する手動スクリプト。

CI では実行しない。ローカルで Ollama を起動してから、backend/ で実行する。

    python -m scripts.evaluate_ai_proofread
"""

from __future__ import annotations

import json
from pathlib import Path

from app.ai import get_proofread_provider
from app.schemas.ai import ProofreadItem

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_CASES_PATH = _BACKEND_ROOT / "tests" / "data" / "ai_proofread_quality_cases.json"


def main() -> int:
    cases: list[dict[str, object]] = json.loads(_CASES_PATH.read_text(encoding="utf-8"))
    items = [
        ProofreadItem(id=str(case["id"]), kind=str(case["kind"]), text=str(case["text"]))
        for case in cases
    ]
    provider = get_proofread_provider()
    suggestions = {suggestion.id: suggestion.corrected for suggestion in provider.proofread(items)}

    passed = 0
    for case in cases:
        case_id = str(case["id"])
        expected = case["expected"]
        actual = suggestions.get(case_id)
        ok = actual == expected
        passed += ok
        mark = "PASS" if ok else "FAIL"
        print(f"{mark} {case_id}: expected={expected!r}, actual={actual!r}")

    print(f"\\nquality score: {passed}/{len(cases)}")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
