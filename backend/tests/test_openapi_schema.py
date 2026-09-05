"""openapi.json が実際のレスポンス（400）と一致しているかの確認。

FastAPI は標準では検証エラーを 422 として文書化するが、このアプリは
`app/main.py` の例外ハンドラで実際には 400 を返すよう変換している。
`app/main.py` の `_custom_openapi` がその食い違いを生成物レベルで
解消していることを確認する。
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_openapi_documents_400_instead_of_422(client: TestClient):
    res = client.get("/api/v1/openapi.json")
    assert res.status_code == 200
    schema = res.json()

    signup_responses = schema["paths"]["/api/v1/auth/signup"]["post"]["responses"]
    assert "400" in signup_responses
    assert "422" not in signup_responses
    assert "ErrorEnvelope" in schema["components"]["schemas"]
