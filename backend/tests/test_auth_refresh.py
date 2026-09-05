"""POST /api/v1/auth/refresh の結合テスト（実 DB）。

ローテーション正常系・reuse 検知（chain 全体失効）・期限切れを確認する。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.models.refresh_token import RefreshToken

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
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


def test_refresh_rotates_token_and_invalidates_old_one(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    old_refresh_token = signup_body["refreshToken"]

    res = client.post(REFRESH_URL, json={"refreshToken": old_refresh_token})
    assert res.status_code == 200
    new_body = res.json()
    assert new_body["refreshToken"] != old_refresh_token

    # 古いトークンはもう使えない。
    res2 = client.post(REFRESH_URL, json={"refreshToken": old_refresh_token})
    assert res2.status_code == 401


def test_refresh_reuse_revokes_entire_chain(client: TestClient, unique_email: str):
    signup_body = _signup(client, unique_email)
    old_refresh_token = signup_body["refreshToken"]

    first = client.post(REFRESH_URL, json={"refreshToken": old_refresh_token})
    assert first.status_code == 200
    rotated_token = first.json()["refreshToken"]

    # 使用済みトークンを再提示（reuse）。
    reuse_res = client.post(REFRESH_URL, json={"refreshToken": old_refresh_token})
    assert reuse_res.status_code == 401

    # reuse 検知により、ローテーションで新しく発行された方も失効しているはず。
    after_reuse = client.post(REFRESH_URL, json={"refreshToken": rotated_token})
    assert after_reuse.status_code == 401


def test_refresh_preserves_remember_me_across_rotation(
    client: TestClient, unique_email: str, db_session
):
    """ローテーションのたびに remember_me（有効期限方針）が変わらないことを確認する。"""
    login_url = "/api/v1/auth/login"
    signup_res = client.post(
        SIGNUP_URL,
        json={
            "email": unique_email,
            "password": PASSWORD,
            "displayName": "テスト太郎",
            "securityQuestion": "好きな食べ物は？",
            "securityAnswer": "ラーメン",
        },
    )
    assert signup_res.status_code == 201

    login_res = client.post(
        login_url, json={"email": unique_email, "password": PASSWORD, "rememberMe": False}
    )
    assert login_res.status_code == 200
    old_refresh_token = login_res.json()["refreshToken"]

    refresh_res = client.post(REFRESH_URL, json={"refreshToken": old_refresh_token})
    assert refresh_res.status_code == 200
    new_refresh_token = refresh_res.json()["refreshToken"]

    from app.security import hash_refresh_token

    token_row = db_session.exec(
        select(RefreshToken).where(
            RefreshToken.token_hash == hash_refresh_token(new_refresh_token)
        )
    ).first()
    assert token_row is not None
    assert token_row.remember_me is False


def test_refresh_unknown_token_returns_401(client: TestClient):
    res = client.post(REFRESH_URL, json={"refreshToken": "not-a-real-token"})
    assert res.status_code == 401


def test_refresh_expired_token_returns_401(
    client: TestClient, unique_email: str, db_session
):
    signup_body = _signup(client, unique_email)
    raw_refresh_token = signup_body["refreshToken"]

    from app.security import hash_refresh_token

    token_hash = hash_refresh_token(raw_refresh_token)
    token_row = db_session.exec(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).first()
    assert token_row is not None
    token_row.expires_at = datetime.now(UTC) - timedelta(days=1)
    db_session.add(token_row)
    db_session.commit()

    res = client.post(REFRESH_URL, json={"refreshToken": raw_refresh_token})
    assert res.status_code == 401
