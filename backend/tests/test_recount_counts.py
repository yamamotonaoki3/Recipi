"""カウント列補正ジョブの結合テスト（Issue #66 / processing-model.md §8）。

BB: 「ズレを実数に補正する」「何度流しても結果が変わらない（冪等）」。
WB: 「ズレている行だけを UPDATE する」分岐（対象ゼロなら 0 件）。
"""

from __future__ import annotations

import uuid
from threading import Thread
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text, update
from sqlmodel import Session, select

from app.db import engine
from app.jobs.recount_counts import main, recount_follow_counts
from app.models.follow import Follow
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


def _recount_is_waiting_for_user_lock() -> bool:
    """補正 UPDATE が users 行のロック待ちになったかを PostgreSQL で確認する。"""
    with engine.connect() as connection:
        row = connection.execute(
            text(
                """
                SELECT pid
                FROM pg_stat_activity
                WHERE pid <> pg_backend_pid()
                  AND state = 'active'
                  AND wait_event_type = 'Lock'
                  AND query ILIKE '%UPDATE users%'
                """
            )
        ).first()
    return row is not None


def test_recount_retries_after_concurrent_follow_commit(
    client: TestClient, db_session: Session
) -> None:
    """フォロー中の users ロックを待っても、コミット後の実数で補正し直す。"""
    _, a_id = _make_user(client)
    _, b_id = _make_user(client)

    # A だけを補正対象にする。フォロー処理がこの値を +1 しても、実数は 1 のまま。
    a = db_session.get(User, a_id)
    assert a is not None
    a.following_count = 99
    db_session.add(a)
    db_session.commit()

    thread_errors: list[BaseException] = []

    def run_recount() -> None:
        try:
            # main() が本番の補正経路（REPEATABLE READ + run_with_retry）を使う。
            main()
        except BaseException as exc:  # noqa: BLE001  スレッド内の失敗を親へ渡す
            thread_errors.append(exc)

    with Session(engine) as follow_session:
        # 通常のフォロー処理と同じ順序・ロックモードで A と B を先にロックする。
        locked_ids = follow_session.exec(
            select(User.id)
            .where(User.id.in_([a_id, b_id]))  # type: ignore[attr-defined]
            .order_by(User.id)  # type: ignore[arg-type]
            .with_for_update(key_share=True)
        ).all()
        assert set(locked_ids) == {a_id, b_id}

        follow_session.add(Follow(follower_id=a_id, followee_id=b_id))
        follow_session.flush()
        follow_session.execute(
            update(User)
            .where(User.id == a_id)  # type: ignore[arg-type]
            .values(following_count=User.following_count + 1)
        )
        follow_session.execute(
            update(User)
            .where(User.id == b_id)  # type: ignore[arg-type]
            .values(follower_count=User.follower_count + 1)
        )

        recount_thread = Thread(target=run_recount)
        recount_thread.start()
        try:
            # 固定時間を待つのではなく、補正 SQL が実際にロック待ちになるまで確認する。
            deadline = monotonic() + 10
            while not _recount_is_waiting_for_user_lock() and monotonic() < deadline:
                sleep(0.01)
            assert _recount_is_waiting_for_user_lock()

            # 補正がロック待ちに入った後で、フォロー処理をコミットする。
            follow_session.commit()
        finally:
            if follow_session.in_transaction():
                follow_session.rollback()

        recount_thread.join(timeout=10)

    assert not recount_thread.is_alive()
    if thread_errors:
        raise thread_errors[0]
    assert _counts(db_session, a_id) == (1, 0)
    assert _counts(db_session, b_id) == (0, 1)
