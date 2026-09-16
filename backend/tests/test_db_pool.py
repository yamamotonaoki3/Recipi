"""DB 接続プールの設定と、枯渇したときの 503（Issue #191）のテスト。

背景: 以前は `create_engine` にプールの設定を渡しておらず、SQLAlchemy の既定
（5 ＋ 予備 10 ＝ 15 接続・待ち上限 30 秒）のまま動いていた。性能テストのスパイクで
接続を取り合い、30 秒待った末に QueuePool のタイムアウトで 500 になっていた（Issue #189）。

BB: 接続待ちがタイムアウトしたとき、API が 503 ＋ `Retry-After` ＋ 統一エラー形式を返す。
WB: 設定の既定値・境界（0 や負の値を弾く）と、その値が実際にエンジンへ渡っていること。

DB には接続しないので `integration` マーカーは付けない（Docker 無しでも動く）。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from app.config import Settings

# --- 設定（単体）-----------------------------------------------------------


def _settings(monkeypatch: pytest.MonkeyPatch, tmp_path, **overrides: str) -> Settings:
    """環境変数だけから Settings を作る（.env を読ませない）。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d_test")
    for key, value in overrides.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=tmp_path / ".env.missing")


def test_pool_settings_have_expected_defaults(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """既定は 10 ＋ 予備 10（合計 20 接続）・待ち 5 秒。"""
    for key in ("DB_POOL_SIZE", "DB_MAX_OVERFLOW", "DB_POOL_TIMEOUT_SECONDS"):
        monkeypatch.delenv(key, raising=False)
    settings = _settings(monkeypatch, tmp_path)

    assert settings.DB_POOL_SIZE == 10
    assert settings.DB_MAX_OVERFLOW == 10
    assert settings.DB_POOL_TIMEOUT_SECONDS == 5.0


def test_pool_settings_can_be_overridden(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """環境変数で上書きできる（環境ごとに変えられることが目的の 1 つ）。"""
    settings = _settings(
        monkeypatch,
        tmp_path,
        DB_POOL_SIZE="3",
        DB_MAX_OVERFLOW="0",
        DB_POOL_TIMEOUT_SECONDS="0.5",
    )

    assert settings.DB_POOL_SIZE == 3
    assert settings.DB_MAX_OVERFLOW == 0  # 予備なしは許す（境界）
    assert settings.DB_POOL_TIMEOUT_SECONDS == 0.5


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("DB_POOL_SIZE", "0"),  # 1 以上。0 だと接続を 1 本も保持できない
        ("DB_POOL_SIZE", "-1"),
        ("DB_MAX_OVERFLOW", "-1"),  # 0 以上
        ("DB_POOL_TIMEOUT_SECONDS", "0"),  # 0 より大きい。0 だと常に即失敗する
        ("DB_POOL_TIMEOUT_SECONDS", "-1"),
    ],
)
def test_pool_settings_reject_out_of_range(
    monkeypatch: pytest.MonkeyPatch, tmp_path, key: str, value: str
):
    """範囲外の値は起動時にエラーにする（気づかないまま動かさない）。"""
    with pytest.raises(ValidationError, match=key):
        _settings(monkeypatch, tmp_path, **{key: value})


def test_engine_uses_configured_pool():
    """設定した値が実際に `create_engine` へ渡っている（既定のままになっていない）。"""
    from app.config import settings
    from app.db import engine

    pool = engine.pool
    assert pool.size() == settings.DB_POOL_SIZE
    # 予備の本数と待ち時間は公開 API が無いので内部属性で確かめる。
    # ここが既定（10 / 30 秒）のままだと Issue #189 の状態に戻る。
    assert pool._max_overflow == settings.DB_MAX_OVERFLOW
    assert pool._timeout == settings.DB_POOL_TIMEOUT_SECONDS


# --- 枯渇したときの応答（結合。DB には接続しない）----------------------------


@pytest.fixture
def pool_exhausted_client(client: TestClient):
    """DB のセッションを取ろうとすると必ずプールのタイムアウトになるクライアント。

    実際に接続を使い切るテストは時間がかかり不安定なので、`get_session` を
    差し替えて同じ例外（`sqlalchemy.exc.TimeoutError`）を送出させる。
    """
    from app.db import get_session
    from app.main import app

    def _raise_pool_timeout():
        raise PoolTimeoutError(
            "QueuePool limit of size 10 overflow 10 reached, connection timed out, timeout 5.00"
        )

    app.dependency_overrides[get_session] = _raise_pool_timeout
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_pool_timeout_returns_503(pool_exhausted_client: TestClient):
    """500 ではなく 503。待たせ続けず「今は無理」と伝えて、再試行の目安を返す。"""
    res = pool_exhausted_client.get("/api/v1/units")

    assert res.status_code == 503
    assert res.headers["Retry-After"] == "1"
    error = res.json()["error"]
    assert error["code"] == "SERVICE_UNAVAILABLE"
    assert error["details"] is None


def test_pool_timeout_is_not_logged_as_unhandled_exception(
    pool_exhausted_client: TestClient, json_logs
):
    """想定内の輻輳なので、スタックトレース付きの `unhandled exception` にしない。

    CloudWatch のメトリクスフィルタ（infra/terraform/monitoring.tf）が
    `unhandled exception` を数えているため、ここが混ざると「バグによる 500」と
    「意図した縮退」を区別できなくなる。
    """
    pool_exhausted_client.get("/api/v1/units")

    messages = [r.get("message") for r in json_logs.records()]
    assert "db pool timeout" in messages
    assert "unhandled exception" not in messages


def test_pool_timeout_does_not_leak_connection_details(pool_exhausted_client: TestClient):
    """内部の事情（プールの本数・SQL）をクライアントに見せない。"""
    body = pool_exhausted_client.get("/api/v1/units").text

    assert "QueuePool" not in body
    assert "timeout" not in body.lower()
