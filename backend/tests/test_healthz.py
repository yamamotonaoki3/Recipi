"""ヘルスチェックの結合テスト（ブラックボックス: 仕様どおりの応答か）。

- /healthz は DB が無くても常に 200
- /healthz/db は DB につながれば "ok"、つながらなければ "unavailable"
  （どちらも HTTP は 200。例外にしない仕様）
- リクエスト ID がレスポンスヘッダに返る
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz_ok(client: TestClient):
    res = client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["env"] == "test"


def test_healthz_returns_request_id_header(client: TestClient):
    res = client.get("/healthz")
    assert res.headers.get("X-Request-ID")  # 何らかの ID が付いている


def test_request_id_is_echoed_when_provided(client: TestClient):
    res = client.get("/healthz", headers={"X-Request-ID": "abc123"})
    assert res.headers["X-Request-ID"] == "abc123"


def test_healthz_db(client: TestClient):
    """CI では postgres service があるので "ok"。
    ローカルで DB 未起動なら "unavailable"（どちらでも 200）。"""
    res = client.get("/healthz/db")
    assert res.status_code == 200
    assert res.json()["database"] in {"ok", "unavailable"}
