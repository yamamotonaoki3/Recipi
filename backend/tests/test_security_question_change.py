"""PUT /api/v1/users/me/security-question の結合テスト（実 DB。Issue #240）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.reauth_attempt import ReauthAttempt
from app.models.user import User

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"
CHANGE_URL = "/api/v1/users/me/security-question"
RESET_REQUEST_URL = "/api/v1/auth/password-reset/request"
RESET_CONFIRM_URL = "/api/v1/auth/password-reset/confirm"

PASSWORD = "TestPass123!"
NEW_PASSWORD = "NewTestPass456!"
OLD_QUESTION = "好きな食べ物は？"
OLD_ANSWER = "ラーメン"
NEW_QUESTION = "初めて飼ったペットの名前は？"
NEW_ANSWER = "ポチ"

# app/services/credentials.py の閾値と同じ値（テストからは import せず、
# 契約として明示的に書く。実装側を緩めたらここで落ちてほしい）。
MAX_PER_USER = 5
MAX_PER_IP = 20


def _signup(client: TestClient, email: str) -> dict[str, Any]:
    res = client.post(
        SIGNUP_URL,
        json={
            "email": email,
            "password": PASSWORD,
            "displayName": "テスト太郎",
            "securityQuestion": OLD_QUESTION,
            "securityAnswer": OLD_ANSWER,
        },
    )
    assert res.status_code == 201, res.text
    return cast("dict[str, Any]", res.json())


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _change_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "currentPassword": PASSWORD,
        "securityQuestion": NEW_QUESTION,
        "securityAnswer": NEW_ANSWER,
    }
    body.update(overrides)
    return body


def _new_user(client: TestClient) -> tuple[str, dict[str, str]]:
    """新しいユーザーを作り、(email, 認証ヘッダー) を返す。"""
    email = f"testuser_{uuid.uuid4().hex}@example.com"
    signed = _signup(client, email)
    return email, _headers(signed["accessToken"])


# --- 基本 -------------------------------------------------------------


def test_changes_question_and_answer(client: TestClient):
    _email, headers = _new_user(client)

    res = client.put(CHANGE_URL, headers=headers, json=_change_body())

    assert res.status_code == 204, res.text
    # 204 は本文を持たない。
    assert res.content == b""


def test_reset_request_returns_the_new_question(client: TestClient):
    email, headers = _new_user(client)

    client.put(CHANGE_URL, headers=headers, json=_change_body())

    res = client.post(RESET_REQUEST_URL, json={"email": email})
    assert res.status_code == 200, res.text
    assert res.json()["securityQuestion"] == NEW_QUESTION


def test_password_reset_succeeds_with_the_new_answer(client: TestClient):
    email, headers = _new_user(client)
    client.put(CHANGE_URL, headers=headers, json=_change_body())

    res = client.post(
        RESET_CONFIRM_URL,
        json={"email": email, "securityAnswer": NEW_ANSWER, "newPassword": NEW_PASSWORD},
    )

    assert res.status_code == 204, res.text


def test_password_reset_fails_with_the_old_answer(client: TestClient):
    email, headers = _new_user(client)
    client.put(CHANGE_URL, headers=headers, json=_change_body())

    res = client.post(
        RESET_CONFIRM_URL,
        json={"email": email, "securityAnswer": OLD_ANSWER, "newPassword": NEW_PASSWORD},
    )

    assert res.status_code == 400, res.text


def test_answer_is_stored_as_an_argon2id_hash(client: TestClient, db_session: Session):
    email, headers = _new_user(client)
    client.put(CHANGE_URL, headers=headers, json=_change_body())

    user = db_session.exec(select(User).where(User.email == email)).one()
    # 平文でないことに加え、Argon2id の形式であることまで確かめる
    # （「平文と違う」だけでは、弱いハッシュに差し替わっても気づけない）。
    assert NEW_ANSWER not in user.security_answer_hash
    assert user.security_answer_hash.startswith("$argon2id$")


@pytest.mark.parametrize(
    "answer",
    [
        "ポチ",  # そのまま
        "  ポチ  ",  # 前後の空白
        "ﾎﾟﾁ",  # 半角カナ
    ],
)
def test_answer_matching_absorbs_notation_differences(client: TestClient, answer: str):
    """保存時・照合時とも正規化される（前後空白の除去・NFKC・casefold）。"""
    email, headers = _new_user(client)
    assert client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code == 204

    res = client.post(
        RESET_CONFIRM_URL,
        json={"email": email, "securityAnswer": answer, "newPassword": NEW_PASSWORD},
    )

    assert res.status_code == 204, res.text


# --- 認証・認可 -------------------------------------------------------


def test_wrong_current_password_returns_403_and_changes_nothing(
    client: TestClient, db_session: Session
):
    email, headers = _new_user(client)

    res = client.put(CHANGE_URL, headers=headers, json=_change_body(currentPassword="WrongPass1!"))

    # 401 にしてはいけない。401 だとクライアント（expoApp/src/api/client.ts）が
    # 「トークン切れ」と解釈してリフレッシュ → 再送 → セッション破棄まで進み、
    # パスワードを打ち間違えただけの利用者がログアウトさせられる。
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "REAUTH_FAILED"

    user = db_session.exec(select(User).where(User.email == email)).one()
    assert user.security_question == OLD_QUESTION


def test_unauthenticated_returns_401(client: TestClient):
    res = client.put(CHANGE_URL, json=_change_body())
    assert res.status_code == 401, res.text


def test_invalid_token_returns_401(client: TestClient):
    res = client.put(CHANGE_URL, headers=_headers("not-a-real-token"), json=_change_body())
    assert res.status_code == 401, res.text


def test_deactivated_user_returns_401_and_changes_nothing(client: TestClient, db_session: Session):
    email, headers = _new_user(client)
    assert client.delete("/api/v1/users/me", headers=headers).status_code == 204

    res = client.put(CHANGE_URL, headers=headers, json=_change_body())

    assert res.status_code == 401, res.text
    user = db_session.exec(select(User).where(User.email == email)).one()
    assert user.security_question == OLD_QUESTION


def test_token_version_bumped_after_authentication_returns_401(
    client: TestClient, db_session: Session
):
    """依存性の認証を通った後に世代が変わったら拒否する。

    パスワードリセットが割り込んだ状況。**同じパスワードへ**リセットすることで、
    「パスワード照合では捕捉できない」ことを確かめる（照合は通ってしまうので、
    世代の確認が無いと素通りする）。
    """
    email, headers = _new_user(client)

    user = db_session.exec(select(User).where(User.email == email)).one()
    user.token_version += 1
    db_session.add(user)
    db_session.commit()

    res = client.put(CHANGE_URL, headers=headers, json=_change_body())

    assert res.status_code == 401, res.text
    db_session.refresh(user)
    assert user.security_question == OLD_QUESTION


# --- 入力検証 ---------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(
            {"securityQuestion": NEW_QUESTION, "securityAnswer": NEW_ANSWER}, id="no-password"
        ),
        pytest.param({"currentPassword": PASSWORD, "securityAnswer": NEW_ANSWER}, id="no-question"),
        pytest.param(
            {"currentPassword": PASSWORD, "securityQuestion": NEW_QUESTION}, id="no-answer"
        ),
    ],
)
def test_missing_fields_are_rejected(client: TestClient, body: dict[str, Any]):
    _email, headers = _new_user(client)
    res = client.put(CHANGE_URL, headers=headers, json=body)
    assert res.status_code == 400, res.text


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"securityQuestion": ""}, id="empty-question"),
        pytest.param({"securityAnswer": ""}, id="empty-answer"),
        pytest.param({"securityAnswer": "   "}, id="blank-answer"),
        pytest.param({"securityQuestion": "あ" * 121}, id="question-too-long"),
        pytest.param({"securityAnswer": "あ" * 101}, id="answer-too-long"),
        pytest.param({"currentPassword": "a" * 73}, id="password-too-long"),
    ],
)
def test_invalid_values_are_rejected(client: TestClient, overrides: dict[str, Any]):
    _email, headers = _new_user(client)
    res = client.put(CHANGE_URL, headers=headers, json=_change_body(**overrides))
    assert res.status_code == 400, res.text


# --- レート制限 -------------------------------------------------------


def _fill_user_quota(client: TestClient, headers: dict[str, str], count: int) -> None:
    """成功するリクエストで枠を `count` 回消費する。"""
    for _ in range(count):
        res = client.put(CHANGE_URL, headers=headers, json=_change_body())
        assert res.status_code == 204, res.text


def test_successful_requests_count_towards_the_user_quota(client: TestClient):
    """成功も数える。数えないと、正しいパスワードを知る相手が Argon2 を無制限に走らせられる。"""
    _email, headers = _new_user(client)

    _fill_user_quota(client, headers, MAX_PER_USER)

    res = client.put(CHANGE_URL, headers=headers, json=_change_body())
    assert res.status_code == 429, res.text


def test_failed_requests_count_towards_the_user_quota(client: TestClient):
    _email, headers = _new_user(client)
    for _ in range(MAX_PER_USER):
        res = client.put(CHANGE_URL, headers=headers, json=_change_body(currentPassword="Wrong1!"))
        assert res.status_code == 403, res.text

    # 403 を返す経路でも記録が残っている（rollback で消えていない）。
    res = client.put(CHANGE_URL, headers=headers, json=_change_body())
    assert res.status_code == 429, res.text


def test_rejected_requests_are_not_recorded(client: TestClient, db_session: Session):
    """429 で弾いた分は記録しない（連打でロック期間が延びないようにするため）。"""
    email, headers = _new_user(client)
    _fill_user_quota(client, headers, MAX_PER_USER)

    user = db_session.exec(select(User).where(User.email == email)).one()
    before = len(
        db_session.exec(select(ReauthAttempt).where(ReauthAttempt.user_id == user.id)).all()
    )

    for _ in range(3):
        assert client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code == 429

    after = len(
        db_session.exec(select(ReauthAttempt).where(ReauthAttempt.user_id == user.id)).all()
    )
    assert after == before


def test_rate_limited_request_does_not_verify_the_password(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """429 のときは Argon2 の検証を呼ばない（CPU を使わせないのが目的なので）。"""
    _email, headers = _new_user(client)
    _fill_user_quota(client, headers, MAX_PER_USER)

    calls = 0

    def _counting(raw_password: str, password_hash: str) -> bool:
        nonlocal calls
        calls += 1
        return False

    # レート制限に引っかかった時点で return するので、差し替えた関数は呼ばれないはず。
    monkeypatch.setattr("app.services.credentials.verify_password", _counting)

    assert client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code == 429
    assert calls == 0


def test_old_attempts_outside_the_window_do_not_count(client: TestClient, db_session: Session):
    """直近 15 分だけを数える。境界より古い記録は判定に影響しない。"""
    email, headers = _new_user(client)
    _fill_user_quota(client, headers, MAX_PER_USER)
    assert client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code == 429

    user = db_session.exec(select(User).where(User.email == email)).one()
    stale = datetime.now(UTC) - timedelta(minutes=16)
    for attempt in db_session.exec(
        select(ReauthAttempt).where(ReauthAttempt.user_id == user.id)
    ).all():
        attempt.created_at = stale
        db_session.add(attempt)
    db_session.commit()

    assert client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code == 204


def test_ip_quota_limits_attempts_across_different_users(client: TestClient):
    """ユーザー単位だけだと、多数のアカウントに 1 回ずつ試せば制限を回避できてしまう。

    `TestClient` はどのリクエストでも同じ IP（"testclient"）になるので、
    別ユーザーを作り続けても IP 単位の上限に到達する。
    """
    seen_429 = False
    # ユーザー単位（5）に達しないよう、1 ユーザーあたり 4 回までにする。
    for _ in range(MAX_PER_IP):
        _email, headers = _new_user(client)
        for _ in range(4):
            status = client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code
            if status == 429:
                seen_429 = True
                break
        if seen_429:
            break

    assert seen_429, "IP 単位の上限に達しなかった"


# --- 監査ログ ---------------------------------------------------------


def test_success_is_audited_without_leaking_secrets(client: TestClient, json_logs: Any):
    _email, headers = _new_user(client)

    assert client.put(CHANGE_URL, headers=headers, json=_change_body()).status_code == 204

    assert json_logs.audit("account.security_question.change"), "監査ログが出ていない"
    raw = json_logs.raw()
    assert PASSWORD not in raw
    assert NEW_ANSWER not in raw
    assert NEW_QUESTION not in raw


def test_failure_is_audited_without_leaking_secrets(client: TestClient, json_logs: Any):
    _email, headers = _new_user(client)

    res = client.put(CHANGE_URL, headers=headers, json=_change_body(currentPassword="Wrong1!"))
    assert res.status_code == 403

    failures = [r for r in json_logs.audit("account.reauth") if r.get("outcome") == "failure"]
    assert failures, "失敗の監査ログが出ていない"
    raw = json_logs.raw()
    assert "Wrong1!" not in raw
    assert NEW_ANSWER not in raw
