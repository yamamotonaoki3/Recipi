"""POST /api/v1/auth/signup の結合テスト（実 DB）。"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"


def _signup_body(email: str, password: str = "TestPass123!") -> dict[str, Any]:
    return {
        "email": email,
        "password": password,
        "displayName": "テスト太郎",
        "securityQuestion": "好きな食べ物は？",
        "securityAnswer": "ラーメン",
    }


def test_signup_succeeds_with_unregistered_email(client: TestClient, unique_email: str):
    res = client.post(SIGNUP_URL, json=_signup_body(unique_email))
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["displayName"] == "テスト太郎"
    assert body["accessToken"]
    assert body["refreshToken"]


def test_signup_duplicate_email_returns_409(client: TestClient, unique_email: str):
    client.post(SIGNUP_URL, json=_signup_body(unique_email))
    res = client.post(SIGNUP_URL, json=_signup_body(unique_email))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"


def test_signup_duplicate_email_is_case_insensitive(client: TestClient, unique_email: str):
    client.post(SIGNUP_URL, json=_signup_body(unique_email))
    res = client.post(SIGNUP_URL, json=_signup_body(unique_email.upper()))
    assert res.status_code == 409


def test_signup_missing_security_question_returns_400(client: TestClient, unique_email: str):
    body = _signup_body(unique_email)
    body["securityQuestion"] = ""
    res = client.post(SIGNUP_URL, json=body)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(("password", "expected_status"), [("Test12!", 400), ("Test123!", 201)])
def test_signup_password_length_boundary(
    client: TestClient, unique_email: str, password: str, expected_status: int
):
    """パスワードは 8 文字未満を拒否する境界テスト（7 文字→400 / 8 文字→201）。"""
    assert len(password) in {7, 8}
    res = client.post(SIGNUP_URL, json=_signup_body(unique_email, password=password))
    assert res.status_code == expected_status


def test_signup_whitespace_only_security_answer_returns_400(
    client: TestClient, unique_email: str
):
    """空白だけの回答は、正規化すると空文字になり本人確認の意味を失うため拒否する。"""
    body = _signup_body(unique_email)
    body["securityAnswer"] = "   "
    res = client.post(SIGNUP_URL, json=body)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"
