"""`app.db.run_with_retry` の単体テスト（Issue #66）。

実 DB につながないので単体テスト（testing.md §1 の線引き）。
WB（実装ベース）: リトライする分岐 / しない分岐 / 上限まで試して諦める分岐を
それぞれ 1 回は通す（分岐網羅）。
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.exc import DBAPIError

from app.db import MAX_RETRIES, run_with_retry


class _FakeOrig(Exception):
    """psycopg の例外の代わり。`sqlstate` だけ持っていればよい。"""

    def __init__(self, sqlstate: str | None) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


def _db_error(sqlstate: str | None) -> DBAPIError:
    return DBAPIError("SELECT 1", {}, _FakeOrig(sqlstate))


class _FakeSession:
    """`commit()` / `rollback()` が何回呼ばれたかだけ数える偽セッション。"""

    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def test_success_on_first_attempt_commits_once() -> None:
    session = _FakeSession()
    calls: list[int] = []

    result = run_with_retry(session, lambda: calls.append(1) or "done")  # type: ignore[arg-type,func-returns-value]

    assert result == "done"
    assert len(calls) == 1
    assert (session.commits, session.rollbacks) == (1, 0)


@pytest.mark.parametrize("sqlstate", ["40001", "40P01"])
def test_retries_then_succeeds(sqlstate: str) -> None:
    """デッドロック / 直列化失敗は、ロールバックしてやり直す（non-functional.md）。"""
    session = _FakeSession()
    attempts: list[int] = []

    def operation() -> str:
        attempts.append(len(attempts))
        if len(attempts) == 1:
            raise _db_error(sqlstate)
        return "ok"

    assert run_with_retry(session, operation) == "ok"  # type: ignore[arg-type]
    assert len(attempts) == 2
    # 1 回目の中断を畳んでから 2 回目 → コミットは成功したときの 1 回だけ。
    assert (session.commits, session.rollbacks) == (1, 1)


def test_non_retryable_error_is_raised_immediately() -> None:
    """リトライ対象外（例: 一意制約違反 23505）はそのまま送出する。"""
    session = _FakeSession()
    attempts: list[int] = []

    def operation() -> None:
        attempts.append(len(attempts))
        raise _db_error("23505")

    with pytest.raises(DBAPIError):
        run_with_retry(session, operation)  # type: ignore[arg-type]

    assert len(attempts) == 1  # やり直していない
    assert (session.commits, session.rollbacks) == (0, 0)


def test_gives_up_after_max_retries() -> None:
    """上限まで試しても駄目なら、握りつぶさず最後の例外を投げ直す。"""
    session = _FakeSession()
    attempts: list[int] = []

    def operation() -> None:
        attempts.append(len(attempts))
        raise _db_error("40P01")

    with pytest.raises(DBAPIError):
        run_with_retry(session, operation)  # type: ignore[arg-type]

    assert len(attempts) == MAX_RETRIES
    assert (session.commits, session.rollbacks) == (0, MAX_RETRIES)


def test_error_without_sqlstate_is_not_retried() -> None:
    """`sqlstate` を持たないドライバ例外でも落ちない（getattr で None 扱い）。"""
    session = _FakeSession()

    class _NoSqlstate(Exception):
        pass

    error = DBAPIError("SELECT 1", {}, _NoSqlstate())

    def operation() -> Any:
        raise error

    with pytest.raises(DBAPIError):
        run_with_retry(session, operation)  # type: ignore[arg-type]

    assert (session.commits, session.rollbacks) == (0, 0)
