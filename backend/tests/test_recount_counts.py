"""カウント列補正ジョブの結合テスト（Issue #66 / processing-model.md §8）。

BB: 「ズレを実数に補正する」「何度流しても結果が変わらない（冪等）」。
WB: 「ズレている行だけを UPDATE する」分岐（対象ゼロなら 0 件）。
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.jobs.recount_counts import recount_follow_counts
from app.models.user import User
from tests.helpers import signup

pytestmark = pytest.mark.integration

USERS_URL = "/api/v1/users"


def _make_user(client: TestClient) -> tuple[dict[str, str], uuid.UUID]:
    name = f"testuser_{uuid.uuid4().hex[:12]}"
    body = signup(client, display_name=name)
    return {"Authorization": f"Bearer {body['accessToken']}"}, uuid.UUID(body["user"]["id"])


def _counts(session: Session, user_id: uuid.UUID) -> tuple[int, int]:
    user = session.get(User, user_id)
    assert user is not None
    session.refresh(user)
    return user.following_count, user.follower_count


def test_recount_fixes_drifted_counts(client: TestClient, db_session: Session) -> None:
    """故意にズラしたカウントが、実数どおりに直る。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)
    assert client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers).status_code == 204

    # 「バグや異常終了でズレた」状況を、DB を直接書き換えて再現する。
    a = db_session.get(User, a_id)
    b = db_session.get(User, b_id)
    assert a is not None and b is not None
    a.following_count = 99
    b.follower_count = 0
    db_session.add(a)
    db_session.add(b)
    db_session.commit()

    fixed = recount_follow_counts(db_session)
    db_session.commit()

    assert fixed >= 2  # 少なくとも今ズラした 2 行は直る
    assert _counts(db_session, a_id) == (1, 0)
    assert _counts(db_session, b_id) == (0, 1)


def test_recount_is_idempotent(client: TestClient, db_session: Session) -> None:
    """ズレが無い状態で流しても何も変えない（＝ 対象 0 件）。何度流しても同じ。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)
    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    # 1 回目でこのテスト以外のズレも含めて全部そろえる。
    recount_follow_counts(db_session)
    db_session.commit()
    before = (_counts(db_session, a_id), _counts(db_session, b_id))

    # 2 回目は直すものが無いので 0 件。
    second = recount_follow_counts(db_session)
    db_session.commit()

    assert second == 0
    assert (_counts(db_session, a_id), _counts(db_session, b_id)) == before


def test_recount_matches_reality_after_unfollow(client: TestClient, db_session: Session) -> None:
    """フォロー → 解除の後も、補正ジョブは実数（0）に一致させる。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)
    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    client.delete(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    recount_follow_counts(db_session)
    db_session.commit()

    assert _counts(db_session, a_id) == (0, 0)
    assert _counts(db_session, b_id) == (0, 0)
