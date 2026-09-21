"""パスワード再設定の試行記録の掃除ジョブ（Issue #85）の結合テスト。

BB（仕様ベース）: 保持期間ちょうど / 1 秒手前 / 1 秒後、設定値の上書きが効くこと、
直近 15 分の記録は残ってレート制限（429）が効いたまま、コマンドとして 0 終了する。
WB（実装ベース）: BATCH_SIZE を超える件数での複数バッチ、対象なし。

## 共有 DB での注意

`tests/conftest.py` の自動 fixture `_reset_rate_limit_tables` が、integration テストの
**前に毎回** `password_reset_attempts` を全件消す（TestClient の IP が全テストで同じため）。
なので、ここで数える記録はこのテストが作ったものだけになる。テストは直列に動かす前提
（pytest-xdist を使うなら、この fixture の全件削除を見直すこと）。
"""

from __future__ import annotations

import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.jobs.cleanup_password_reset_attempts import cleanup_password_reset_attempts

pytestmark = pytest.mark.integration

REQUEST_URL = "/api/v1/auth/password-reset/request"


def _email() -> str:
    return f"testuser_{uuid.uuid4().hex}@example.com"


def _insert(email: str, created_at: datetime) -> uuid.UUID:
    """試行記録を 1 行、指定の時刻で作る（API を通すと created_at を選べないため）。"""
    row_id = uuid.uuid4()
    with Session(engine) as s:
        s.execute(
            text(
                "INSERT INTO password_reset_attempts (id, email, ip_address, created_at) "
                "VALUES (:i, :e, 'testclient', :c)"
            ),
            {"i": row_id, "e": email, "c": created_at},
        )
        s.commit()
    return row_id


def _exists(row_id: uuid.UUID) -> bool:
    with Session(engine) as s:
        count = s.execute(
            text("SELECT count(*) FROM password_reset_attempts WHERE id = :i"), {"i": row_id}
        ).scalar_one()
    return int(count) == 1


def _run(**kwargs: Any) -> int:
    with Session(engine) as session:
        return cleanup_password_reset_attempts(session, **kwargs)


@pytest.mark.parametrize("retention_days", [None, 3])
def test_retention_boundaries(monkeypatch: pytest.MonkeyPatch, retention_days: int | None) -> None:
    if retention_days is not None:
        monkeypatch.setattr(settings, "PASSWORD_RESET_ATTEMPT_RETENTION_DAYS", retention_days)
    # 基準時刻は 1 回だけ取り、境界・各行の時刻・ジョブの now をすべてここから作る。
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=settings.PASSWORD_RESET_ATTEMPT_RETENTION_DAYS)
    email = _email()
    exact = _insert(email, cutoff)
    before = _insert(email, cutoff + timedelta(seconds=1))
    after = _insert(email, cutoff - timedelta(seconds=1))

    deleted = _run(now=now)

    assert deleted == 2
    assert not _exists(exact)
    assert not _exists(after)
    assert _exists(before)


def test_deletes_in_multiple_batches() -> None:
    now = datetime.now(UTC)
    old = now - timedelta(days=settings.PASSWORD_RESET_ATTEMPT_RETENTION_DAYS, seconds=1)
    ids = [_insert(_email(), old) for _ in range(7)]

    deleted = _run(now=now, batch_size=3)

    assert deleted == 7
    assert not any(_exists(i) for i in ids)


def test_no_target_deletes_nothing() -> None:
    now = datetime.now(UTC)
    recent = _insert(_email(), now - timedelta(minutes=1))

    assert _run(now=now) == 0
    assert _exists(recent)


def test_rate_limit_still_applies_after_cleanup(client: TestClient) -> None:
    """直近 15 分の記録は消えないので、上限に達したメールは掃除の後も 429 のまま。"""
    email = _email()
    for _ in range(5):
        # 未登録メールなので 404。1 回ずつ試行記録が作られ、5 回で上限に達する。
        assert client.post(REQUEST_URL, json={"email": email}).status_code == 404

    assert _run() == 0

    assert client.post(REQUEST_URL, json={"email": email}).status_code == 429


def test_runs_as_a_command() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "app.jobs.cleanup_password_reset_attempts"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
