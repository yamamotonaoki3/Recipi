"""AI校正の契約・プロバイダ境界テスト。"""

from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError

from app.ai import (
    AnthropicProofreadProvider,
    OllamaProofreadProvider,
    ProofreadError,
    StubProofreadProvider,
)
from app.config import settings
from app.schemas.ai import ProofreadItem, ProofreadRequest


def test_stub_returns_only_deterministic_corrections() -> None:
    result = StubProofreadProvider().proofread(
        [
            ProofreadItem(id="title", kind="title", text="肉じゃかの作り方"),
            ProofreadItem(id="step", kind="step", text="じゃがいもを切る"),
        ]
    )
    assert len(result) == 1
    assert result[0].id == "title"
    assert result[0].original == "肉じゃかの作り方"
    assert result[0].corrected == "肉じゃがの作り方"


def test_proofread_request_rejects_item_limit() -> None:
    with pytest.raises(ValidationError):
        ProofreadRequest(
            items=[ProofreadItem(id=str(i), kind="step", text="x") for i in range(201)]
        )


def test_proofread_request_rejects_total_text_limit() -> None:
    with pytest.raises(ValidationError):
        ProofreadRequest(
            items=[
                ProofreadItem(id="a", kind="step", text="a" * 2_000),
                ProofreadItem(id="b", kind="step", text="b" * 2_000),
                ProofreadItem(id="c", kind="step", text="c" * 2_000),
                ProofreadItem(id="d", kind="step", text="d" * 2_001),
            ]
        )


# --- プロバイダの応答が壊れていたとき（Issue #199）---------------------------
#
# 通信の失敗だけでなく「応答の形が壊れている」場合も ProofreadError にしないと、
# API 層で 503（AI_UNAVAILABLE）に変換されず、500 が外に漏れる。
# 外部サービスの都合で 500 を返さないことを、ここで固定する。


class _FakeResponse:
    """`httpx.post` の戻り値の代わり。HTTP としては成功しているが中身が壊れている。"""

    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


_ITEMS = [ProofreadItem(id="title", kind="title", text="肉じゃかの作り方")]


def test_ollama_null_message_becomes_proofread_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """`{"message": null}` は `.get("content")` で AttributeError になる。"""
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: _FakeResponse({"message": None}))

    with pytest.raises(ProofreadError):
        OllamaProofreadProvider().proofread(_ITEMS)


def test_anthropic_empty_content_becomes_proofread_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """`content: []` は添字アクセスで IndexError になる。"""
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: _FakeResponse({"content": []}))
    # キー未設定だと呼び出す前に落ちてしまうので、テスト専用のダミー値を入れる。
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-only-not-a-real-key")

    with pytest.raises(ProofreadError):
        AnthropicProofreadProvider().proofread(_ITEMS)
