"""POST /api/v1/auth/logout の結合テスト（実 DB）。"""

from __future__ import annotations

from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
LOGOUT_URL = "/api/v1/auth/logout"
REFRESH_URL = "/api/v1/auth/refresh"

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


def test_logout_without_access_token_returns_401(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    res = client.post(LOGOUT_URL, json={"refreshToken": signup_body["refreshToken"]})
    assert res.status_code == 401


def test_logout_revokes_refresh_token_chain(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    access_token = signup_body["accessToken"]
    refresh_token = signup_body["refreshToken"]

    res = client.post(
        LOGOUT_URL,
        json={"refreshToken": refresh_token},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert res.status_code == 204

    # ログアウト後は同じ refreshToken で再ログインできない（＝失効している）。
    refresh_res = client.post(REFRESH_URL, json={"refreshToken": refresh_token})
    assert refresh_res.status_code == 401


def test_logout_cannot_revoke_another_users_refresh_token(client: TestClient):
    import uuid

    email_a = f"testuser_{uuid.uuid4().hex}@example.com"
    email_b = f"testuser_{uuid.uuid4().hex}@example.com"
    user_a = _signup(client, email_a)
    user_b = _signup(client, email_b)

    # ユーザー A が、ユーザー B のリフレッシュトークンを渡してログアウトを試みる。
    res = client.post(
        LOGOUT_URL,
        json={"refreshToken": user_b["refreshToken"]},
        headers={"Authorization": f"Bearer {user_a['accessToken']}"},
    )
    assert res.status_code == 204

    # ユーザー B のリフレッシュトークンは失効していない（引き続き使える）。
    refresh_res = client.post(REFRESH_URL, json={"refreshToken": user_b["refreshToken"]})
    assert refresh_res.status_code == 200


def test_logout_with_unknown_refresh_token_is_idempotent(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    access_token = signup_body["accessToken"]

    res = client.post(
        LOGOUT_URL,
        json={"refreshToken": "not-a-real-token"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert res.status_code == 204
