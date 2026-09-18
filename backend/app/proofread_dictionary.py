"""料理文脈の漢字変換ミスに対する候補辞書。

辞書は誤りを確定しない。候補をプロンプトへ渡し、前後の文脈に照らした最終判断は
LLMに任せる。したがって、一般の文章で正しい語まで機械的に書き換えることはない。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas.ai import ProofreadItem, ProofreadSuggestion


@dataclass(frozen=True)
class DictionaryCandidate:
    """原文中の語と、料理文脈でのみ検討する置換候補。"""

    source: str
    replacements: tuple[str, ...]
    context_pattern: re.Pattern[str] | None = None


# 一般の国語辞典は正しい語かどうかしか示せず、料理の動作として妥当かは決められない。
# ここには、誤変換されやすく、かつ料理文脈で明確な候補を持つ語だけを登録する。
_COOKING_CONVERSION_CANDIDATES = (
    DictionaryCandidate(source="肉じゃか", replacements=("肉じゃが",)),
    DictionaryCandidate(
        source="訳",
        replacements=("焼く",),
        # 「この料理の訳」のように名詞として正しい用法を候補化しない。料理で焼く対象に
        # なりやすい食材を目的語にして、文末へ置かれた明白な変換ミスだけを対象にする。
        context_pattern=re.compile(
            r"(?:肉|鶏肉|豚肉|牛肉|魚|鮭|さば|野菜|パン)を訳(?=[。！？」\s]|$)"
        ),
    ),
)


def candidate_hints(items: list[ProofreadItem]) -> list[dict[str, object]]:
    """入力に含まれる辞書候補だけを、LLM向けの小さなヒントとして返す。"""
    hints: list[dict[str, object]] = []
    for item in items:
        candidates = [
            {"source": entry.source, "replacements": list(entry.replacements)}
            for entry in _COOKING_CONVERSION_CANDIDATES
            if entry.source in item.text
            and (entry.context_pattern is None or entry.context_pattern.search(item.text))
        ]
        if candidates:
            hints.append({"id": item.id, "candidates": candidates})
    return hints


def dictionary_suggestions(items: list[ProofreadItem]) -> list[ProofreadSuggestion]:
    """文脈条件を満たす一意の候補だけを、手動適用用の修正案として返す。"""
    suggestions: list[ProofreadSuggestion] = []
    for item in items:
        corrected = item.text
        for entry in _COOKING_CONVERSION_CANDIDATES:
            if entry.source not in item.text or len(entry.replacements) != 1:
                continue
            if entry.context_pattern is not None and not entry.context_pattern.search(item.text):
                continue
            corrected = corrected.replace(entry.source, entry.replacements[0])
        if corrected != item.text:
            suggestions.append(
                ProofreadSuggestion(
                    id=item.id,
                    original=item.text,
                    corrected=corrected,
                    changed=True,
                    note="料理文脈の漢字変換候補を検出しました",
                )
            )
    return suggestions
