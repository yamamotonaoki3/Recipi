"""実データベースにつなぐ結合テスト。

`@pytest.mark.integration` を付けている:
- CI（GitHub Actions）では postgres の service が立っているので常に実行。
- ローカルで Docker を起動していないときは
  `pytest -m "not integration"` で除外できる。

Phase 0 なのでテーブルはまだ無い。ここで確認するのは「マイグレーションを
適用したテスト DB に対して `SELECT 1` が通る」という土台部分だけ。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import check_db_connection

pytestmark = pytest.mark.integration


def test_can_connect_to_database():
    assert check_db_connection() is True


def test_healthz_db_reports_ok(client: TestClient):
    res = client.get("/healthz/db")
    assert res.status_code == 200
    assert res.json()["database"] == "ok"
