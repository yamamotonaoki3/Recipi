"""app/text_normalize.py の単体テスト（DB 不要）。"""

from __future__ import annotations

import pytest

from app.text_normalize import normalize_search_text, split_search_terms


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Hello  ", "hello"),
        ("ＡＢＣ", "abc"),  # 全角英字 → NFKC で半角化 → casefold
        ("ｇ", "g"),  # 全角 g
        ("Kg", "kg"),
        ("大さじ", "大さじ"),  # 日本語はそのまま
    ],
)
def test_normalize_search_text(raw: str, expected: str) -> None:
    assert normalize_search_text(raw) == expected


def test_split_search_terms_half_and_full_width_space() -> None:
    assert split_search_terms("玉ねぎ 豚肉", max_terms=5, max_term_length=30) == ["玉ねぎ", "豚肉"]
    assert split_search_terms("玉ねぎ　豚肉", max_terms=5, max_term_length=30) == ["玉ねぎ", "豚肉"]


def test_split_search_terms_no_space_is_single_term() -> None:
    assert split_search_terms("玉ねぎ豚肉", max_terms=5, max_term_length=30) == ["玉ねぎ豚肉"]


def test_split_search_terms_rejects_too_many_terms() -> None:
    with pytest.raises(ValueError, match="最大 5 語"):
        split_search_terms("a b c d e f", max_terms=5, max_term_length=30)


def test_split_search_terms_rejects_too_long_term() -> None:
    with pytest.raises(ValueError, match="最大 30 文字"):
        split_search_terms("x" * 31, max_terms=5, max_term_length=30)
