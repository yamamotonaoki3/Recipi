"""app/dependencies.py の get_current_user の分岐テスト（実 DB）。

token_version の一致 / 不一致で 401 になるかどうかを、DB を直接書き換えて確認する
（パスワードリセット経由ではなく、この依存性自体の分岐をピンポイントで見る）。
"""

from __future__ import annotations

import uuid
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.models.user import User

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


def test_token_version_match_allows_request(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    res = client.patch(
        ME_URL,
        json={"displayName": "OK"},
        headers={"Authorization": f"Bearer {signup_body['accessToken']}"},
    )
    assert res.status_code == 200


def test_token_version_mismatch_returns_401(client: TestClient, unique_email: str, db_session):
    signup_body = _signup(client, unique_email)
    user_id = uuid.UUID(signup_body["user"]["id"])

    user = db_session.get(User, user_id)
    assert user is not None
    user.token_version += 1
    db_session.add(user)
    db_session.commit()

    res = client.patch(
        ME_URL,
        json={"displayName": "NG"},
        headers={"Authorization": f"Bearer {signup_body['accessToken']}"},
    )
    assert res.status_code == 401


def test_missing_authorization_header_returns_401(client: TestClient):
    res = client.patch(ME_URL, json={"displayName": "NG"})
    assert res.status_code == 401


def test_malformed_token_returns_401(client: TestClient):
    res = client.patch(
        ME_URL,
        json={"displayName": "NG"},
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert res.status_code == 401
