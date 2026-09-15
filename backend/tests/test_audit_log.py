"""監査ログ・アクセスログの結合テスト（実 DB。Issue #170）。

実際のエンドポイントを叩き、期待する監査イベント（action / outcome）が出ること、
どのログにも平文のパスワード・メールアドレス・トークンが含まれないことを確認する。
テストデータは架空のもの（`@example.com`・`testuser_` 接頭辞）だけを使う。
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.audit import email_hash
from tests.helpers import PASSWORD, recipe_payload, signup

pytestmark = pytest.mark.integration

LOGIN_URL = "/api/v1/auth/login"
REFRESH_URL = "/api/v1/auth/refresh"
WRONG_PASSWORD = "WrongPass999!"


def _assert_no_plaintext_secrets(raw: str, *secrets: str) -> None:
    for secret in secrets:
        assert secret not in raw, "ログに平文の秘密・個人情報が含まれています"


def test_login_success_and_failure_are_audited(client: TestClient, json_logs):
    user = signup(client)
    email = user["email"]

    bad = client.post(LOGIN_URL, json={"email": email, "password": WRONG_PASSWORD})
    assert bad.status_code == 401
    good = client.post(LOGIN_URL, json={"email": email, "password": PASSWORD})
    assert good.status_code == 200

    failure, success = json_logs.audit("auth.login")
    assert failure["outcome"] == "failure"
    assert failure["reason"] == "invalid_credentials"
    assert failure["level"] == "WARNING"
    assert failure["email_hash"] == email_hash(email)
    assert success["outcome"] == "success"
    assert success["user_id"] == user["user"]["id"]
    assert success["client_ip"] == "testclient"
    login_access = [r for r in json_logs.of_type("access") if r["path"] == LOGIN_URL]
    assert len(login_access) == 2
    assert login_access[0]["user_id"] == "-"
    assert login_access[1]["user_id"] == user["user"]["id"]
    (signup_event,) = json_logs.audit("auth.signup")
    assert signup_event["outcome"] == "success"

    _assert_no_plaintext_secrets(
        json_logs.raw(),
        email,
        PASSWORD,
        WRONG_PASSWORD,
        user["refreshToken"],
        good.json()["refreshToken"],
        good.json()["accessToken"],
    )


def test_unknown_email_login_is_audited_without_email(client: TestClient, json_logs):
    email = f"testuser_{uuid.uuid4().hex}@example.com"
    res = client.post(LOGIN_URL, json={"email": email, "password": WRONG_PASSWORD})
    assert res.status_code == 401

    (event,) = json_logs.audit("auth.login")
    assert event["reason"] == "invalid_credentials"
    assert event["user_id"] == "-"
    _assert_no_plaintext_secrets(json_logs.raw(), email, WRONG_PASSWORD)


def test_refresh_token_reuse_is_audited(client: TestClient, json_logs):
    user = signup(client)
    old_token = user["refreshToken"]
    assert client.post(REFRESH_URL, json={"refreshToken": old_token}).status_code == 200
    assert client.post(REFRESH_URL, json={"refreshToken": old_token}).status_code == 401

    (event,) = json_logs.audit("auth.refresh")  # 成功したローテーションは出さない
    assert event["outcome"] == "failure"
    assert event["reason"] == "token_reuse_detected"
    assert event["user_id"] == user["user"]["id"]
    _assert_no_plaintext_secrets(json_logs.raw(), old_token)


def test_logout_is_audited(client: TestClient, json_logs):
    user = signup(client)
    res = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {user['accessToken']}"},
        json={"refreshToken": user["refreshToken"]},
    )
    assert res.status_code == 204

    (event,) = json_logs.audit("auth.logout")
    assert event["user_id"] == user["user"]["id"]
    _assert_no_plaintext_secrets(json_logs.raw(), user["refreshToken"], user["accessToken"])


def test_password_reset_failures_are_audited(client: TestClient, json_logs):
    user = signup(client)
    email = user["email"]
    unknown = f"testuser_{uuid.uuid4().hex}@example.com"

    assert (
        client.post("/api/v1/auth/password-reset/request", json={"email": unknown}).status_code
        == 404
    )
    wrong_answer = "ちがう答え_テスト"
    res = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"email": email, "securityAnswer": wrong_answer, "newPassword": "NewTestPass456!"},
    )
    assert res.status_code == 400

    (request_event,) = json_logs.audit("auth.password_reset.request")
    assert request_event["reason"] == "not_found"
    assert request_event["email_hash"] == email_hash(unknown)
    (confirm_event,) = json_logs.audit("auth.password_reset.confirm")
    assert confirm_event["reason"] == "invalid"
    assert confirm_event["email_hash"] == email_hash(email)
    _assert_no_plaintext_secrets(
        json_logs.raw(), email, unknown, wrong_answer, "NewTestPass456!", "ラーメン"
    )


def test_recipe_delete_is_audited_with_route_template(client: TestClient, json_logs):
    user = signup(client)
    headers = {"Authorization": f"Bearer {user['accessToken']}"}
    created = client.post("/api/v1/recipes", headers=headers, json=recipe_payload())
    assert created.status_code == 201
    recipe_id = created.json()["id"]

    assert client.delete(f"/api/v1/recipes/{recipe_id}", headers=headers).status_code == 204

    (event,) = json_logs.audit("recipe.delete")
    assert event["recipe_id"] == recipe_id
    assert event["user_id"] == user["user"]["id"]
    deletes = [r for r in json_logs.of_type("access") if r["method"] == "DELETE"]
    (access,) = deletes
    assert access["path"] == "/api/v1/recipes/{recipe_id}"
    assert access["status"] == 204
    assert access["user_id"] == user["user"]["id"]  # 認証済みユーザーがアクセスログに載る
    assert access["request_id"] == event["request_id"]


def test_account_delete_is_audited(client: TestClient, json_logs):
    user = signup(client)
    headers = {"Authorization": f"Bearer {user['accessToken']}"}
    assert client.delete("/api/v1/users/me", headers=headers).status_code == 204

    (event,) = json_logs.audit("account.delete")
    assert event["outcome"] == "success"
    assert event["user_id"] == user["user"]["id"]
    _assert_no_plaintext_secrets(json_logs.raw(), user["email"], user["accessToken"])


def test_forbidden_origin_is_still_access_logged(client: TestClient, json_logs):
    """Origin チェック（403）もアクセスログに残る（ミドルウェアの順序の確認）。"""
    res = client.post(
        LOGIN_URL,
        headers={"Origin": "https://evil.example.com"},
        json={"email": "testuser_x@example.com", "password": WRONG_PASSWORD},
    )
    assert res.status_code == 403

    (access,) = json_logs.of_type("access")
    assert access["status"] == 403
    assert access["level"] == "WARNING"
    assert access["request_id"] == res.headers["X-Request-ID"]
