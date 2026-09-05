"""POST /api/v1/auth/password-reset/* の結合テスト（実 DB）。"""

from __future__ import annotations

from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
LOGIN_URL = "/api/v1/auth/login"
REQUEST_URL = "/api/v1/auth/password-reset/request"
CONFIRM_URL = "/api/v1/auth/password-reset/confirm"

PASSWORD = "TestPass123!"
NEW_PASSWORD = "NewTestPass456!"
SECURITY_QUESTION = "好きな食べ物は？"
SECURITY_ANSWER = "ラーメン"


def _signup(client: TestClient, email: str) -> dict[str, Any]:
    res = client.post(
        SIGNUP_URL,
        json={
            "email": email,
            "password": PASSWORD,
            "displayName": "テスト太郎",
            "securityQuestion": SECURITY_QUESTION,
            "securityAnswer": SECURITY_ANSWER,
        },
    )
    assert res.status_code == 201
    return cast("dict[str, Any]", res.json())


def test_password_reset_request_returns_security_question(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    res = client.post(REQUEST_URL, json={"email": unique_email})
    assert res.status_code == 200
    assert res.json()["securityQuestion"] == SECURITY_QUESTION


def test_password_reset_request_unregistered_email_returns_404(
    client: TestClient, unique_email: str
):
    res = client.post(REQUEST_URL, json={"email": unique_email})
    assert res.status_code == 404


def test_password_reset_confirm_success_allows_login_with_new_password(
    client: TestClient, unique_email: str
):
    _signup(client, unique_email)
    res = client.post(
        CONFIRM_URL,
        json={
            "email": unique_email,
            "securityAnswer": SECURITY_ANSWER,
            "newPassword": NEW_PASSWORD,
        },
    )
    assert res.status_code == 204

    login_res = client.post(LOGIN_URL, json={"email": unique_email, "password": NEW_PASSWORD})
    assert login_res.status_code == 200


def test_password_reset_confirm_revokes_old_access_token(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    old_access_token = signup_body["accessToken"]
    old_refresh_token = signup_body["refreshToken"]

    res = client.post(
        CONFIRM_URL,
        json={
            "email": unique_email,
            "securityAnswer": SECURITY_ANSWER,
            "newPassword": NEW_PASSWORD,
        },
    )
    assert res.status_code == 204

    # リセット前のアクセストークンは token_version 不一致で 401 になる。
    me_res = client.patch(
        "/api/v1/users/me",
        json={"displayName": "変更後"},
        headers={"Authorization": f"Bearer {old_access_token}"},
    )
    assert me_res.status_code == 401

    # リセット前のリフレッシュトークンも失効している。
    refresh_res = client.post(
        "/api/v1/auth/refresh", json={"refreshToken": old_refresh_token}
    )
    assert refresh_res.status_code == 401


def test_password_reset_confirm_wrong_answer_returns_400(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    res = client.post(
        CONFIRM_URL,
        json={"email": unique_email, "securityAnswer": "ちがう答え", "newPassword": NEW_PASSWORD},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_password_reset_confirm_short_new_password_returns_400(
    client: TestClient, unique_email: str
):
    """newPassword が短すぎる場合も、他の失敗ケースと同じ 400/一般化メッセージにする

    （Pydantic の Field 制約に任せると、答え不一致などとは別のエラー形式に
    なってしまい、失敗理由が外から見分けられてしまうため）。
    """
    _signup(client, unique_email)
    res = client.post(
        CONFIRM_URL,
        json={"email": unique_email, "securityAnswer": SECURITY_ANSWER, "newPassword": "Short1!"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_password_reset_confirm_unregistered_email_returns_400(
    client: TestClient, unique_email: str
):
    res = client.post(
        CONFIRM_URL,
        json={
            "email": unique_email,
            "securityAnswer": SECURITY_ANSWER,
            "newPassword": NEW_PASSWORD,
        },
    )
    assert res.status_code == 400


def test_password_reset_request_lockout_after_threshold(client: TestClient, unique_email: str):
    # 未登録メールへの request 連打（アカウント列挙目的の総当たり）も
    # レート制限の対象になる（暫定閾値: 直近 15 分に 5 回）。
    for _ in range(5):
        res = client.post(REQUEST_URL, json={"email": unique_email})
        assert res.status_code == 404

    locked_res = client.post(REQUEST_URL, json={"email": unique_email})
    assert locked_res.status_code == 429


def test_password_reset_confirm_lockout_after_threshold(client: TestClient, unique_email: str):
    _signup(client, unique_email)
    wrong_body = {
        "email": unique_email,
        "securityAnswer": "ちがう答え",
        "newPassword": NEW_PASSWORD,
    }

    # 暫定閾値: 直近 15 分に 5 回失敗すると 429（app/api/auth.py 参照）。
    for _ in range(5):
        res = client.post(CONFIRM_URL, json=wrong_body)
        assert res.status_code == 400

    locked_res = client.post(CONFIRM_URL, json=wrong_body)
    assert locked_res.status_code == 429
