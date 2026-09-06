"""検索・重複判定に使う「単一値の正規化」をまとめるモジュール。

ここでやるのは **1 つのタイトル / 1 つの材料名 / 1 つの単位** という
「単一の文字列」を、表記ゆれを吸収した比較用のキーに変換することだけ。

検索窓に入力された「玉ねぎ 豚肉」のような**複数語のクエリを空白で分割する**
処理は別物（features/search.md §3「スペースと正規化の順序」）。分割は
`app/api` 側で先に行い、分割後の各語をこの関数で正規化する。

正規化の内容（features/unit.md §3・search.md §3・data-model.md）:
- 前後の空白を除去
- NFKC 正規化で全角/半角・互換文字の表記ゆれを統一（`ｇ`→`g`、`Ｇ`→`G` 等）
- casefold で大文字小文字を無視（`Kg` と `kg` を同一視）

かな/カナ・送り仮名のゆれ吸収や `pg_trgm` の採否は Phase 4 の宿題
（docs/requirements/todo.md #9）。ここでは最小限にとどめる。
"""

from __future__ import annotations

import unicodedata


def normalize_search_text(value: str) -> str:
    """単一の文字列を、検索・重複判定に使う比較用キーへ正規化する。"""
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def split_search_terms(query: str, *, max_terms: int, max_term_length: int) -> list[str]:
    """検索クエリを空白区切りの語に分割し、各語を正規化して返す。

    features/search.md §3 の手順どおり「**まず空白で分割** → 各語を正規化」の
    順で処理する。半角スペース・全角スペース `　`・連続スペースはすべて
    語の区切りとして扱い、空文字の語は捨てる。

    語数が `max_terms` を超える、またはいずれかの語が `max_term_length`
    文字を超える場合は `ValueError` を投げる（呼び出し側で 400 にする）。
    """
    # str.split() は引数なしだと「連続する任意の空白（全角スペース含む）」を
    # 区切りにし、前後の空白も無視してくれる。
    raw_terms = query.split()
    if len(raw_terms) > max_terms:
        raise ValueError(f"検索語は最大 {max_terms} 語までです")
    terms: list[str] = []
    for raw in raw_terms:
        if len(raw) > max_term_length:
            raise ValueError(f"検索語は 1 語あたり最大 {max_term_length} 文字までです")
        normalized = normalize_search_text(raw)
        if normalized:
            terms.append(normalized)
    return terms
