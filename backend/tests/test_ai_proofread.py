"""AI校正の契約・プロバイダ境界テスト。"""

from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app.ai import (
    AnthropicProofreadProvider,
    OllamaProofreadProvider,
    ProofreadError,
    StubProofreadProvider,
    _JsonHttpProvider,
    _prompt,
    warm_local_ollama,
)
from app.config import settings
from app.errors import unavailable
from app.main import handle_app_error
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


def test_ollama_unexpected_provider_error_becomes_proofread_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """想定外のプロバイダ例外もAPI層で503に変換できる例外へ統一する。"""

    def fail(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(httpx, "post", fail)

    with pytest.raises(ProofreadError):
        OllamaProofreadProvider().proofread(_ITEMS)


def test_ollama_request_keeps_model_loaded(monkeypatch: pytest.MonkeyPatch) -> None:
    """校正リクエストも keep_alive を渡し、ウォームアップ後のモデルを維持する。"""
    captured: dict[str, object] = {}

    def fake_post(*args: object, **kwargs: object) -> _FakeResponse:
        captured.update(kwargs)
        return _FakeResponse(
            {
                "message": {
                    "content": '{"suggestions":[{"id":"title","original":"肉じゃかの作り方",'
                    '"corrected":"肉じゃがの作り方","changed":true}]}'
                }
            }
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(settings, "OLLAMA_KEEP_ALIVE", "-1m")

    OllamaProofreadProvider().proofread(_ITEMS)

    assert isinstance(captured["json"], dict)
    assert captured["json"]["keep_alive"] == "-1m"


def test_development_ollama_warmup_loads_and_keeps_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """development + local の起動時だけ、空の生成リクエストでモデルを読み込む。"""
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object) -> _FakeResponse:
        captured["url"] = url
        captured.update(kwargs)
        return _FakeResponse({})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "AI_PROVIDER", "local")
    monkeypatch.setattr(settings, "OLLAMA_KEEP_ALIVE", "-1m")
    monkeypatch.setattr(settings, "OLLAMA_WARMUP_TIMEOUT_SECONDS", 60.0)

    warm_local_ollama()

    assert captured["url"] == "http://localhost:11434/api/generate"
    assert captured["json"] == {
        "model": "qwen3.5:9b",
        "prompt": "",
        "stream": False,
        "keep_alive": "-1m",
    }
    assert captured["timeout"] == 60.0


@pytest.mark.parametrize("app_env", ["test", "demo", "production"])
def test_ollama_warmup_skips_non_development(monkeypatch: pytest.MonkeyPatch, app_env: str) -> None:
    """テスト・デモ・本番の起動時にはローカル Ollama へ接続しない。"""
    called = False

    def fake_post(*args: object, **kwargs: object) -> _FakeResponse:
        nonlocal called
        called = True
        return _FakeResponse({})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(settings, "APP_ENV", app_env)
    monkeypatch.setattr(settings, "AI_PROVIDER", "local")

    warm_local_ollama()

    assert called is False


def test_ollama_warmup_failure_does_not_prevent_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ollama停止中は警告にとどめ、保存など AI 以外の API を起動可能にする。"""

    def fail(*args: object, **kwargs: object) -> _FakeResponse:
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", fail)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "AI_PROVIDER", "local")

    warm_local_ollama()


def test_ai_error_response_allows_local_frontend_origin() -> None:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/ai/proofread",
            "headers": [(b"origin", b"http://localhost:8081")],
            "query_string": b"",
            "scheme": "http",
            "server": ("localhost", 8000),
            "client": ("testclient", 50000),
        }
    )

    response = handle_app_error(request, unavailable())

    assert response.status_code == 503
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert response.headers["access-control-allow-credentials"] == "true"


# --- 使えない候補の捨て方（Issue #204）---------------------------------------
#
# 小型モデルは `original` を書き換えて返すことがある（空白の挿入・要約・別語への
# 置換）。実測では既定の温度で 6 件中 4 件がこれだった。1 件のために応答全体を
# 503 にすると、同じ応答に入っていた正しい候補まで失われる。**その 1 件だけ捨てて
# 残りは返す**のが正しい（捨てればズレた修正案を適用する事故は起きない）。


def test_parse_discards_only_the_unusable_suggestions() -> None:
    """使えない候補だけを捨て、入力と一致する候補は返す。"""
    items = [
        ProofreadItem(id="title", kind="title", text="肉じゃかの作り方"),
        ProofreadItem(id="s1", kind="step", text="じゃがいもの皮をむいて乱切りにするに。"),
        ProofreadItem(id="s2", kind="step", text="やわらかくなるまで煮ます。"),
    ]
    payload: dict[str, object] = {
        "suggestions": [
            # 使える候補（入力と完全一致）。
            {
                "id": "title",
                "original": "肉じゃかの作り方",
                "corrected": "肉じゃがの作り方",
                "changed": True,
            },
            # original に空白を挿入している（捏造）→ 捨てる。
            {
                "id": "s1",
                "original": "じゃがいも の皮を むいて 乱切りにするに。",
                "corrected": "じゃがいもの皮をむいて乱切りにする。",
                "changed": True,
            },
            # 入力に無い id → 捨てる。
            {
                "id": "unknown",
                "original": "存在しない",
                "corrected": "存在しない案",
                "changed": True,
            },
            # corrected が空白のみ → 捨てる。
            {
                "id": "s2",
                "original": "やわらかくなるまで煮ます。",
                "corrected": "   ",
                "changed": True,
            },
        ]
    }

    result = _JsonHttpProvider()._parse(payload, items)

    assert [s.id for s in result] == ["title"]
    assert result[0].corrected == "肉じゃがの作り方"


def test_parse_skips_unchanged_suggestions() -> None:
    """`corrected` が `original` と同じ候補は、変更なしとして返さない。"""
    items = [ProofreadItem(id="ing1", kind="ingredient", text="醤油")]
    payload: dict[str, object] = {
        "suggestions": [{"id": "ing1", "original": "醤油", "corrected": "醤油", "changed": False}]
    }

    assert _JsonHttpProvider()._parse(payload, items) == []


def test_parse_discards_whitespace_only_changes() -> None:
    """空白だけの表記変更は誤字脱字候補として提示しない。"""
    items = [ProofreadItem(id="ingredient", kind="ingredient", text="しょう油 大さじ1")]
    payload: dict[str, object] = {
        "suggestions": [
            {
                "id": "ingredient",
                "original": "しょう油 大さじ1",
                "corrected": "しょう油 大さじ 1",
                "changed": True,
            }
        ]
    }

    assert _JsonHttpProvider()._parse(payload, items) == []


def test_parse_discards_semantically_distant_suggestion() -> None:
    """要約・創作のように原文から離れた候補は破棄する。"""
    items = [ProofreadItem(id="step", kind="step", text="醤油 大さじ1と砂糖 小さじ2を加える。")]
    payload: dict[str, object] = {
        "suggestions": [
            {
                "id": "step",
                "original": "醤油 大さじ1と砂糖 小さじ2を加える。",
                "corrected": "油を熱し、玉ねぎとにんじんを炒める。",
                "changed": True,
            }
        ]
    }

    assert _JsonHttpProvider()._parse(payload, items) == []


def test_parse_discards_suggestion_that_changes_numbers() -> None:
    """分量の数値を変更する候補は破棄する。"""
    items = [ProofreadItem(id="step", kind="step", text="砂糖 小さじ2を加える。")]
    payload: dict[str, object] = {
        "suggestions": [
            {
                "id": "step",
                "original": "砂糖 小さじ2を加える。",
                "corrected": "砂糖 小さじ3を加える。",
                "changed": True,
            }
        ]
    }

    assert _JsonHttpProvider()._parse(payload, items) == []


def test_prompt_contains_minimal_correction_and_safety_rules() -> None:
    prompt = _prompt(
        [
            ProofreadItem(id="ingredient", kind="ingredient", text="醤油 大さじ1"),
            ProofreadItem(id="step", kind="step", text="肉じゃかを煮る。"),
        ]
    )

    assert "誤字、脱字" in prompt
    assert "数字と単位を絶対に変更せず" in prompt
    assert "originalは入力textを完全にコピー" in prompt
    assert "修正不要または判断に自信がない" in prompt
