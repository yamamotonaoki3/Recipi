"""POST /api/v1/auth/login の結合テスト（実 DB）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.models.refresh_token import RefreshToken
from app.security import hash_refresh_token

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
LOGIN_URL = "/api/v1/auth/login"

PASSWORD = "TestPass123!"


def _signup(client: TestClient, email: str) -> None:
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


def test_login_succeeds_with_correct_credentials(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    res = client.post(LOGIN_URL, json={"email": unique_email, "password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["accessToken"]
    assert body["refreshToken"]


def test_login_unregistered_email_returns_401(client: TestClient, unique_email: str):
    res = client.post(LOGIN_URL, json={"email": unique_email, "password": PASSWORD})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_login_wrong_password_returns_401(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    res = client.post(LOGIN_URL, json={"email": unique_email, "password": "WrongPass123!"})
    assert res.status_code == 401


def test_login_overlong_password_returns_400(client: TestClient, unique_email: str):
    """実在するパスワードは72文字までしか登録できないため、それより長い入力は
    Argon2 の検証に回さず 400 で弾く（無駄な CPU/メモリ消費を防ぐ）。"""
    _signup(client, unique_email)
    res = client.post(LOGIN_URL, json={"email": unique_email, "password": "x" * 73})
    assert res.status_code == 400


@pytest.mark.parametrize(("remember_me", "expected_remember_me"), [(True, True), (False, False)])
def test_login_persists_remember_me_on_refresh_token(
    client: TestClient, unique_email: str, db_session, remember_me: bool, expected_remember_me: bool
):
    """rememberMe に応じてリフレッシュトークンの有効期限方針を切り替える

    （processing-model.md §6: login は rememberMe で有効期限を調整する）。
    """
    _signup(client, unique_email)
    res = client.post(
        LOGIN_URL, json={"email": unique_email, "password": PASSWORD, "rememberMe": remember_me}
    )
    assert res.status_code == 200
    raw_refresh_token = res.json()["refreshToken"]

    token_hash = hash_refresh_token(raw_refresh_token)
    token_row = db_session.exec(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).first()
    assert token_row is not None
    assert token_row.remember_me is expected_remember_me
