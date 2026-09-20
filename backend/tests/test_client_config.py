"""公開クライアント設定APIのテスト（Issue #230）。"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_client_config_returns_image_dimension_in_camel_case(
    client: TestClient, monkeypatch
) -> None:
    """画像選択に必要な公開上限だけを、認証なしで返す。"""
    from app.config import settings

    monkeypatch.setattr(settings, "IMAGE_MAX_DIMENSION", 1536)

    response = client.get("/api/v1/client-config")

    assert response.status_code == 200
    assert response.json() == {"imageMaxDimension": 1536}
