"""PATCH /api/v1/users/me の結合テスト（実 DB）。"""

from __future__ import annotations

from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
ME_URL = "/api/v1/users/me"

PASSWORD = "TestPass123!"


def _signup(client: TestClient, email: str) -> dict[str, Any]:
    res = client.post(
        SIGNUP_URL,
        json={
            "email": email,
            "password": PASSWORD,
            "displayName": "テスト太郎",
            "securityQuestion": "好きな食べ物は？",
            "securityAnswer": "ラーメン",
        },
    )
    assert res.status_code == 201
    return cast("dict[str, Any]", res.json())


def test_update_display_name_succeeds(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    access_token = signup_body["accessToken"]

    res = client.patch(
        ME_URL,
        json={"displayName": "テスト次郎"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert res.status_code == 200
    assert res.json()["displayName"] == "テスト次郎"


def test_update_display_name_without_token_returns_401(client: TestClient):
    res = client.patch(ME_URL, json={"displayName": "テスト次郎"})
    assert res.status_code == 401


@pytest.mark.parametrize("display_name", ["", "あ" * 31])
def test_update_display_name_length_boundary_returns_400(
    client: TestClient, unique_email: str, display_name: str
):
    signup_body = _signup(client, unique_email)
    access_token = signup_body["accessToken"]

    res = client.patch(
        ME_URL,
        json={"displayName": display_name},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert res.status_code == 400
