"""PUT /api/v1/users/me/email の結合テスト（実 DB。Issue #241）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.refresh_token import RefreshToken
from app.models.user import User

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
LOGIN_URL = "/api/v1/auth/login"
REFRESH_URL = "/api/v1/auth/refresh"
CHANGE_URL = "/api/v1/users/me/email"
ME_URL = "/api/v1/auth/me"

PASSWORD = "TestPass123!"
QUESTION = "好きな食べ物は？"
ANSWER = "ラーメン"

# app/services/credentials.py の閾値と同じ値（実装を緩めたらここで落ちてほしい）。
MAX_PER_USER = 5


def _email() -> str:
    return f"testuser_{uuid.uuid4().hex}@example.com"


def _signup(client: TestClient, email: str) -> dict[str, Any]:
    res = client.post(
        SIGNUP_URL,
        json={
            "email": email,
            "password": PASSWORD,
            "displayName": "テスト太郎",
            "securityQuestion": QUESTION,
            "securityAnswer": ANSWER,
        },
    )
    assert res.status_code == 201, res.text
    return cast("dict[str, Any]", res.json())


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _body(email: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "currentPassword": PASSWORD,
        "email": email,
        "rememberMe": True,
    }
    body.update(overrides)
    return body


def _new_user(client: TestClient) -> tuple[str, dict[str, Any]]:
    email = _email()
    return email, _signup(client, email)


# --- 基本 -------------------------------------------------------------


def test_changes_the_email_and_returns_a_usable_session(client: TestClient):
    old_email, signed = _new_user(client)
    new_email = _email()

    res = client.put(CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(new_email))

    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["refreshToken"], "非 Web では本文にリフレッシュトークンが要る"

    # 返ってきたアクセストークンがそのまま使える。
    me = client.get(ME_URL, headers=_headers(payload["accessToken"]))
    assert me.status_code == 200, me.text
    assert old_email != new_email


def test_can_log_in_with_the_new_email_but_not_the_old_one(client: TestClient):
    old_email, signed = _new_user(client)
    new_email = _email()
    assert (
        client.put(CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(new_email))
    ).status_code == 200

    ok = client.post(LOGIN_URL, json={"email": new_email, "password": PASSWORD, "rememberMe": False})
    assert ok.status_code == 200, ok.text

    ng = client.post(LOGIN_URL, json={"email": old_email, "password": PASSWORD, "rememberMe": False})
    assert ng.status_code == 401, ng.text


def test_changing_to_the_same_email_also_issues_a_new_session(client: TestClient):
    """同じアドレスでも特別扱いしない（応答の形を 1 つに保つため）。"""
    email, signed = _new_user(client)

    res = client.put(CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(email))

    assert res.status_code == 200, res.text
    # 古いアクセストークンは失効している。
    assert client.get(ME_URL, headers=_headers(signed["accessToken"])).status_code == 401
    # 新しいものは使える。
    assert client.get(ME_URL, headers=_headers(res.json()["accessToken"])).status_code == 200


# --- 重複 -------------------------------------------------------------


def test_taken_email_returns_409(client: TestClient):
    other_email, _ = _new_user(client)
    _email_mine, mine = _new_user(client)

    res = client.put(CHANGE_URL, headers=_headers(mine["accessToken"]), json=_body(other_email))

    assert res.status_code == 409, res.text


def test_deactivated_users_email_returns_the_same_409(client: TestClient):
    """退会済みが持つアドレスも同じ 409。区別すると退会の事実が漏れる。"""
    gone_email, gone = _new_user(client)
    assert client.delete("/api/v1/users/me", headers=_headers(gone["accessToken"])).status_code == 204

    _mine_email, mine = _new_user(client)
    res = client.put(CHANGE_URL, headers=_headers(mine["accessToken"]), json=_body(gone_email))

    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "CONFLICT"


@pytest.mark.parametrize("transform", [str.upper, lambda e: f"  {e}  "])
def test_duplicate_detection_normalizes_the_address(client: TestClient, transform: Any):
    other_email, _ = _new_user(client)
    _mine_email, mine = _new_user(client)

    res = client.put(
        CHANGE_URL, headers=_headers(mine["accessToken"]), json=_body(transform(other_email))
    )

    assert res.status_code == 409, res.text


def test_conflict_rolls_back_the_email_and_the_session(client: TestClient, db_session: Session):
    """重複で失敗したら、メール・世代・失効・新トークンがまとめて戻る。"""
    other_email, _ = _new_user(client)
    mine_email, mine = _new_user(client)

    before = db_session.exec(select(User).where(User.email == mine_email)).one()
    version_before = before.token_version

    assert (
        client.put(CHANGE_URL, headers=_headers(mine["accessToken"]), json=_body(other_email))
    ).status_code == 409

    db_session.expire_all()
    after = db_session.exec(select(User).where(User.email == mine_email)).one()
    assert after.email == mine_email
    assert after.token_version == version_before
    # 元のセッションはそのまま使える（失効していない）。
    assert client.get(ME_URL, headers=_headers(mine["accessToken"])).status_code == 200


# --- セッション -------------------------------------------------------


def test_other_devices_lose_both_access_and_refresh_tokens(client: TestClient):
    """本題。`token_version` を上げるだけでは refresh で復帰できてしまう。"""
    email, first = _new_user(client)
    # 2 台目としてログインする。
    second = client.post(
        LOGIN_URL, json={"email": email, "password": PASSWORD, "rememberMe": True}
    ).json()

    changed = client.put(
        CHANGE_URL, headers=_headers(first["accessToken"]), json=_body(_email())
    )
    assert changed.status_code == 200, changed.text

    # 2 台目のアクセストークンは失効。
    assert client.get(ME_URL, headers=_headers(second["accessToken"])).status_code == 401
    # 2 台目のリフレッシュトークンも使えない（ここが `token_version` だけでは足りない部分）。
    revived = client.post(REFRESH_URL, json={"refreshToken": second["refreshToken"]})
    assert revived.status_code == 401, revived.text


def test_the_caller_keeps_working_with_the_returned_tokens(client: TestClient):
    _email_old, signed = _new_user(client)
    changed = client.put(
        CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(_email())
    ).json()

    assert client.get(ME_URL, headers=_headers(changed["accessToken"])).status_code == 200
    refreshed = client.post(REFRESH_URL, json={"refreshToken": changed["refreshToken"]})
    assert refreshed.status_code == 200, refreshed.text


def test_old_refresh_token_does_not_kill_the_new_chain(client: TestClient):
    """新しいチェーンで発行するので、旧トークンの再提示が新トークンを巻き込まない。"""
    _email_old, signed = _new_user(client)
    changed = client.put(
        CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(_email())
    ).json()

    # 失効済みの旧トークンを提示（リユース検知が走る）。
    assert client.post(REFRESH_URL, json={"refreshToken": signed["refreshToken"]}).status_code == 401
    # それでも新しいチェーンは生きている。
    assert client.post(REFRESH_URL, json={"refreshToken": changed["refreshToken"]}).status_code == 200


@pytest.mark.parametrize("remember_me", [True, False])
def test_remember_me_controls_the_new_token_lifetime(
    client: TestClient, db_session: Session, remember_me: bool
):
    _email_old, signed = _new_user(client)
    new_email = _email()

    res = client.put(
        CHANGE_URL,
        headers=_headers(signed["accessToken"]),
        json=_body(new_email, rememberMe=remember_me),
    )
    assert res.status_code == 200, res.text

    user = db_session.exec(select(User).where(User.email == new_email)).one()
    token = db_session.exec(
        select(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))  # type: ignore[union-attr]
    ).one()
    assert token.remember_me is remember_me
    days = (token.expires_at.replace(tzinfo=UTC) - datetime.now(UTC)).days
    # 保持 ON は長期（既定 60 日）、OFF は 1 日。境界の揺れを見込んで幅で確かめる。
    assert days > 7 if remember_me else days <= 1


# --- 認証・入力 -------------------------------------------------------


def test_wrong_password_returns_403_and_changes_nothing(client: TestClient, db_session: Session):
    email, signed = _new_user(client)

    res = client.put(
        CHANGE_URL,
        headers=_headers(signed["accessToken"]),
        json=_body(_email(), currentPassword="WrongPass1!"),
    )

    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "REAUTH_FAILED"
    assert db_session.exec(select(User).where(User.email == email)).one_or_none() is not None


def test_unauthenticated_returns_401(client: TestClient):
    assert client.put(CHANGE_URL, json=_body(_email())).status_code == 401


def test_deactivated_user_returns_401(client: TestClient):
    _email_old, signed = _new_user(client)
    assert client.delete("/api/v1/users/me", headers=_headers(signed["accessToken"])).status_code == 204

    res = client.put(CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(_email()))
    assert res.status_code == 401, res.text


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"currentPassword": PASSWORD, "rememberMe": True}, id="no-email"),
        pytest.param({"email": "x@example.com", "rememberMe": True}, id="no-password"),
        pytest.param({"currentPassword": PASSWORD, "email": "x@example.com"}, id="no-remember-me"),
        pytest.param(
            {"currentPassword": PASSWORD, "email": "not-an-email", "rememberMe": True},
            id="bad-format",
        ),
        pytest.param(
            {"currentPassword": PASSWORD, "email": "", "rememberMe": True}, id="empty-email"
        ),
        pytest.param(
            {"currentPassword": "a" * 73, "email": "x@example.com", "rememberMe": True},
            id="password-too-long",
        ),
    ],
)
def test_invalid_bodies_are_rejected(client: TestClient, body: dict[str, Any]):
    _email_old, signed = _new_user(client)
    res = client.put(CHANGE_URL, headers=_headers(signed["accessToken"]), json=body)
    assert res.status_code == 400, res.text


def test_rate_limit_is_shared_with_the_security_question_change(client: TestClient):
    """再認証の枠は #240 と共有する（守る資源が同じ Argon2 検証のため）。"""
    _email_old, signed = _new_user(client)
    headers = _headers(signed["accessToken"])
    token = signed["accessToken"]

    # 秘密の質問の変更で枠を使い切る。変更のたびにトークンは失効しないので同じ token でよい。
    for _ in range(MAX_PER_USER):
        res = client.put(
            "/api/v1/users/me/security-question",
            headers=_headers(token),
            json={
                "currentPassword": PASSWORD,
                "securityQuestion": QUESTION,
                "securityAnswer": ANSWER,
            },
        )
        assert res.status_code == 204, res.text

    res = client.put(CHANGE_URL, headers=headers, json=_body(_email()))
    assert res.status_code == 429, res.text


# --- 監査ログ ---------------------------------------------------------


def test_audit_logs_do_not_contain_the_raw_email(client: TestClient, json_logs: Any):
    _email_old, signed = _new_user(client)
    new_email = _email()

    assert (
        client.put(CHANGE_URL, headers=_headers(signed["accessToken"]), json=_body(new_email))
    ).status_code == 200

    assert json_logs.audit("account.email.change"), "監査ログが出ていない"
    raw = json_logs.raw()
    assert new_email not in raw
    assert PASSWORD not in raw


def test_conflict_is_audited(client: TestClient, json_logs: Any):
    other_email, _ = _new_user(client)
    _mine_email, mine = _new_user(client)

    assert (
        client.put(CHANGE_URL, headers=_headers(mine["accessToken"]), json=_body(other_email))
    ).status_code == 409

    failures = [
        r for r in json_logs.audit("account.email.change") if r.get("outcome") == "failure"
    ]
    assert failures, "重複の監査ログが出ていない"
    assert other_email not in json_logs.raw()
