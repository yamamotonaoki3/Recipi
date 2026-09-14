"""POST /api/v1/auth/login の結合テスト（実 DB）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.db import engine
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_refresh_token

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
LOGIN_URL = "/api/v1/auth/login"
REACTIVATE_URL = "/api/v1/auth/reactivate"
ME_URL = "/api/v1/auth/me"

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


def test_me_returns_current_user(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    login_res = client.post(LOGIN_URL, json={"email": unique_email, "password": PASSWORD})
    access_token = login_res.json()["accessToken"]

    res = client.get(ME_URL, headers={"Authorization": f"Bearer {access_token}"})

    assert res.status_code == 200, res.text
    assert res.json() == {
        "id": login_res.json()["user"]["id"],
        "displayName": "テスト太郎",
        "avatarUrl": None,
    }


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid-token"}])
def test_me_requires_a_valid_access_token(client: TestClient, headers: dict[str, str]):
    res = client.get(ME_URL, headers=headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_login_unregistered_email_returns_401(client: TestClient, unique_email: str):
    res = client.post(LOGIN_URL, json={"email": unique_email, "password": PASSWORD})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_login_wrong_password_returns_401(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    res = client.post(LOGIN_URL, json={"email": unique_email, "password": "WrongPass123!"})
    assert res.status_code == 401


def test_deactivated_account_requires_explicit_reactivation(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    login_res = client.post(LOGIN_URL, json={"email": unique_email, "password": PASSWORD})
    assert login_res.status_code == 200
    headers = {"Authorization": f"Bearer {login_res.json()['accessToken']}"}
    assert client.delete("/api/v1/users/me", headers=headers).status_code == 204

    login_res = client.post(LOGIN_URL, json={"email": unique_email, "password": PASSWORD})
    assert login_res.status_code == 409
    assert login_res.json()["error"]["code"] == "ACCOUNT_DEACTIVATED"

    deactivated_token_res = client.get(ME_URL, headers=headers)
    assert deactivated_token_res.status_code == 401

    reactivate_res = client.post(
        REACTIVATE_URL,
        json={"email": unique_email, "password": PASSWORD, "rememberMe": True},
    )
    assert reactivate_res.status_code == 200, reactivate_res.text
    assert reactivate_res.json()["accessToken"]
    with engine.connect() as conn:
        assert (
            conn.execute(select(User.deleted_at).where(User.email == unique_email)).scalar_one()
            is None
        )


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


def test_tauri_dev_login_returns_token_instead_of_cookie(client: TestClient, unique_email: str):
    """Tauri dev は localhost Origin でも Stronghold 用の token を受け取る。"""
    _signup(client, unique_email)

    res = client.post(
        LOGIN_URL,
        json={"email": unique_email, "password": PASSWORD, "rememberMe": True},
        headers={
            "Origin": "http://localhost:8081",
            "X-Recipi-Auth-Transport": "token",
        },
    )

    assert res.status_code == 200
    assert res.json()["refreshToken"]
    assert "recipi_refresh_token" not in res.headers.get("set-cookie", "")
