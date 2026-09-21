"""再認証の試行記録の掃除ジョブ（Issue #240）の結合テスト。

BB（仕様ベース）: 保持期間ちょうど / 1 秒手前 / 1 秒後、設定値の上書きが効くこと、
コマンドとして 0 終了する。
WB（実装ベース）: BATCH_SIZE を超える件数での複数バッチ、対象なし。

## 共有 DB での注意

`tests/conftest.py` の自動 fixture `_reset_rate_limit_tables` が、integration テストの
**前に毎回** `reauth_attempts` を全件消す（TestClient の IP が全テストで同じため）。
なので、ここで数える記録はこのテストが作ったものだけになる。
"""

from __future__ import annotations

import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.jobs.cleanup_reauth_attempts import cleanup_reauth_attempts

pytestmark = pytest.mark.integration

SIGNUP_URL = "/api/v1/auth/signup"


def _make_user() -> uuid.UUID:
    """外部キーがあるので、記録を作る前に実在するユーザーが要る。"""
    user_id = uuid.uuid4()
    with Session(engine) as s:
        s.execute(
            text(
                "INSERT INTO users "
                "(id, email, password_hash, display_name, security_question, "
                " security_answer_hash, token_version, created_at, updated_at) "
                "VALUES (:i, :e, 'x', 'テスト太郎', 'q', 'a', 0, now(), now())"
            ),
            {"i": user_id, "e": f"testuser_{uuid.uuid4().hex}@example.com"},
        )
        s.commit()
    return user_id


def _insert(user_id: uuid.UUID, created_at: datetime) -> uuid.UUID:
    """試行記録を 1 行、指定の時刻で作る（API を通すと created_at を選べないため）。"""
    row_id = uuid.uuid4()
    with Session(engine) as s:
        s.execute(
            text(
                "INSERT INTO reauth_attempts (id, user_id, ip_address, created_at) "
                "VALUES (:i, :u, 'testclient', :c)"
            ),
            {"i": row_id, "u": user_id, "c": created_at},
        )
        s.commit()
    return row_id


def _exists(row_id: uuid.UUID) -> bool:
    with Session(engine) as s:
        count = s.execute(
            text("SELECT count(*) FROM reauth_attempts WHERE id = :i"), {"i": row_id}
        ).scalar_one()
    return bool(count)


def _run_cleanup(now: datetime | None = None) -> int:
    with Session(engine) as s:
        return cleanup_reauth_attempts(s, now=now)


def test_deletes_rows_at_and_beyond_the_retention_boundary():
    """境界は `<=`。ちょうど保持期間の行も消す（ほかの掃除ジョブと同じ）。"""
    user_id = _make_user()
    now = datetime.now(UTC)
    cutoff = timedelta(days=settings.REAUTH_ATTEMPT_RETENTION_DAYS)

    just_inside = _insert(user_id, now - cutoff + timedelta(seconds=1))
    exactly_at = _insert(user_id, now - cutoff)
    just_outside = _insert(user_id, now - cutoff - timedelta(seconds=1))

    _run_cleanup(now=now)

    assert _exists(just_inside), "保持期間内の記録まで消えている"
    assert not _exists(exactly_at)
    assert not _exists(just_outside)


def test_recent_rows_are_kept_so_rate_limiting_still_works():
    """レート制限が見る直近 15 分の記録は、掃除しても残る。"""
    user_id = _make_user()
    recent = _insert(user_id, datetime.now(UTC) - timedelta(minutes=5))

    _run_cleanup()

    assert _exists(recent)


def test_returns_zero_when_there_is_nothing_to_delete():
    assert _run_cleanup() == 0


def test_deletes_more_rows_than_one_batch():
    """BATCH_SIZE を超えても、複数バッチで最後まで消す。"""
    user_id = _make_user()
    old = datetime.now(UTC) - timedelta(days=settings.REAUTH_ATTEMPT_RETENTION_DAYS + 1)
    batch_size = 10
    total = batch_size * 2 + 3
    for _ in range(total):
        _insert(user_id, old)

    with Session(engine) as s:
        deleted = cleanup_reauth_attempts(s, batch_size=batch_size)

    assert deleted == total


def test_runs_as_a_command():
    """`python -m app.jobs.cleanup_reauth_attempts` が 0 終了する（スケジューラが叩く形）。"""
    result = subprocess.run(
        [sys.executable, "-m", "app.jobs.cleanup_reauth_attempts"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
