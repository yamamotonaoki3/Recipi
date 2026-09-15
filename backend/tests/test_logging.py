"""構造化ログ・アクセスログの単体テスト（DB 不要。Issue #170）。

- `app/logging_config.py`: 共通フィールド・マスク・uvicorn ログの扱い
- `app/middleware.py`: アクセスログ・X-Request-ID・想定外の例外
- `app/audit.py`: email_hash・ログ出力の失敗で本処理を止めないこと

ミドルウェアの確認には、DB を使わない最小の FastAPI アプリを使う
（本物のアプリのルートは多くが DB を必要とするため）。
"""

from __future__ import annotations

import io
import logging
import sys
import warnings

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.audit import audit_event, email_hash
from app.logging_config import (
    REDACTED,
    build_handler,
    configure_logging,
    current_user_id,
    set_current_user_id,
)
from app.middleware import RequestIdMiddleware

logger = logging.getLogger("tests.logging")


def _mini_app() -> FastAPI:
    """RequestIdMiddleware だけを付けた、DB を使わない確認用アプリ。"""
    mini = FastAPI()
    mini.add_middleware(RequestIdMiddleware)

    def fake_current_user() -> str:
        # 本物の get_current_user と同じく「同期の依存関数」の中でセットする
        # （スレッドプールで動いても、アクセスログから見えることの確認）。
        set_current_user_id("testuser-001")
        return "testuser-001"

    @mini.get("/items/{item_id}")
    def get_item(item_id: int, user: str = Depends(fake_current_user)) -> dict[str, object]:
        logger.info("inside endpoint")
        return {"item_id": item_id, "user": user}

    @mini.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @mini.get("/boom")
    def boom() -> None:
        raise RuntimeError("boom for test")

    return mini


# --- フォーマッタ・フィルタ ----------------------------------------------------


def test_json_log_has_common_fields(json_logs):
    logger.info("hello", extra={"recipe_id": "r-1"})

    (record,) = [r for r in json_logs.records() if r["message"] == "hello"]
    assert record["level"] == "INFO"
    assert record["logger"] == "tests.logging"
    assert record["time"].endswith("Z")  # UTC
    assert record["request_id"] == "-"  # リクエストの外
    assert record["user_id"] == "-"
    assert record["service"] == "recipi-api"
    assert record["env"] == "test"
    assert record["recipe_id"] == "r-1"


def test_build_handler_defaults_to_stdout():
    handler = build_handler()
    stream_handler = handler if isinstance(handler, logging.StreamHandler) else None
    assert stream_handler is not None
    assert stream_handler.stream is sys.stdout


def test_warnings_are_emitted_as_json_after_configure_logging():
    root = logging.getLogger()
    previous_handlers = root.handlers[:]
    previous_level = root.level
    stream = io.StringIO()
    # pytest はテストごとに warnings の出力先を差し替えて元に戻す。captureWarnings(True) は
    # 「すでに有効なら何もしない」ので、一度無効に戻してから、catch_warnings の中で
    # 有効にし直す（他のテストの実行順に左右されないように）。
    logging.captureWarnings(False)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("always")
            configure_logging("INFO", "json", app_env="test")
            root.handlers.clear()
            root.addHandler(build_handler("json", stream=stream, app_env="test"))
            warnings.warn("warning for test", UserWarning, stacklevel=1)
            logging.captureWarnings(False)
        records = [__import__("json").loads(line) for line in stream.getvalue().splitlines()]
        assert any(record["logger"] == "py.warnings" for record in records)
        assert any("warning for test" in record["message"] for record in records)
    finally:
        logging.captureWarnings(False)
        root.handlers.clear()
        root.handlers.extend(previous_handlers)
        root.setLevel(previous_level)


def test_sensitive_extra_fields_are_redacted(json_logs):
    logger.info(
        "secrets",
        extra={
            "password": "TestPass123!",
            "payload": {"refresh_token": "raw-refresh-value", "name": "テスト太郎"},
            "items": [{"access_token": "raw-access-value"}],
            "Authorization": "Bearer raw-bearer-value",
        },
    )

    (record,) = [r for r in json_logs.records() if r["message"] == "secrets"]
    assert record["password"] == REDACTED
    assert record["payload"] == {"refresh_token": REDACTED, "name": "テスト太郎"}
    assert record["items"] == [{"access_token": REDACTED}]
    assert record["Authorization"] == REDACTED
    raw = json_logs.raw()
    for secret in ("TestPass123!", "raw-refresh-value", "raw-access-value", "raw-bearer-value"):
        assert secret not in raw


def test_text_format_includes_request_id_and_user():
    stream = io.StringIO()
    handler = build_handler("text", stream=stream)
    record = logging.LogRecord("tests.text", logging.INFO, __file__, 1, "plain %s", ("x",), None)
    assert handler.filter(record)
    handler.emit(record)

    line = stream.getvalue()
    assert "[INFO] tests.text (- user=-) plain x" in line


def test_configure_logging_routes_uvicorn_logs_to_root():
    """uvicorn のログは root の JSON handler に流し、uvicorn のアクセスログは止める。"""
    root = logging.getLogger()
    saved_handlers, saved_level = list(root.handlers), root.level
    try:
        configure_logging("INFO", "json", app_env="test")
        assert len(root.handlers) == 1
        assert logging.getLogger("uvicorn.error").handlers == []
        assert logging.getLogger("uvicorn.error").propagate is True
        assert logging.getLogger("uvicorn.access").disabled is True
    finally:
        logging.captureWarnings(False)  # configure_logging が有効にしたものを戻す
        root.handlers[:] = saved_handlers
        root.setLevel(saved_level)


def test_set_current_user_id_outside_request_is_noop():
    set_current_user_id("testuser-999")
    assert current_user_id() == "-"


# --- アクセスログ（ミドルウェア） ----------------------------------------------


def test_access_log_one_line_per_request_with_route_template(json_logs):
    res = TestClient(_mini_app()).get("/items/42?q=secret-search-word")
    assert res.status_code == 200

    (access,) = json_logs.of_type("access")
    assert access["level"] == "INFO"
    assert access["method"] == "GET"
    assert access["path"] == "/items/{item_id}"  # 実際の 42 ではなくテンプレート
    assert access["status"] == 200
    assert isinstance(access["duration_ms"], int | float)
    assert access["client_ip"] == "testclient"
    # 依存関数（スレッドプール）でセットした user_id がアクセスログにも載る。
    assert access["user_id"] == "testuser-001"
    assert access["request_id"] == res.headers["X-Request-ID"]
    # エンドポイント内のログにも同じ request_id / user_id が付く。
    (inner,) = [r for r in json_logs.records() if r["message"] == "inside endpoint"]
    assert inner["request_id"] == access["request_id"]
    assert inner["user_id"] == "testuser-001"
    # クエリ文字列（検索語）はアプリのログに出さない。httpx の行はテスト用クライアント
    # 自身のログ（アプリは httpx を使わない）なので検査の対象から外す。
    app_lines = [r for r in json_logs.records() if r["logger"] != "httpx"]
    assert "secret-search-word" not in str(app_lines)


def test_access_log_level_for_client_error_and_unknown_path(json_logs):
    res = TestClient(_mini_app()).get("/no-such-path")
    assert res.status_code == 404

    (access,) = json_logs.of_type("access")
    assert access["level"] == "WARNING"
    assert access["path"] == "/no-such-path"  # ルートが無いときは実際のパス
    assert access["user_id"] == "-"


def test_health_check_access_log_is_debug(json_logs):
    client = TestClient(_mini_app())
    client.get("/healthz")
    assert json_logs.of_type("access") == []  # INFO では出ない

    logging.getLogger().setLevel(logging.DEBUG)
    client.get("/healthz")
    (access,) = json_logs.of_type("access")
    assert access["level"] == "DEBUG"


@pytest.mark.parametrize(
    ("incoming", "kept"),
    [
        ("req-123_ABC", True),
        ("has space", False),
        ("x" * 65, False),
        ("a/b", False),
    ],
)
def test_request_id_header_is_validated(json_logs, incoming: str, kept: bool):
    res = TestClient(_mini_app()).get("/items/1", headers={"X-Request-ID": incoming})

    returned = res.headers["X-Request-ID"]
    assert (returned == incoming) is kept
    if not kept:
        assert len(returned) == 32  # 新しく発行した uuid4().hex
    (access,) = json_logs.of_type("access")
    assert access["request_id"] == returned


def test_unhandled_exception_is_logged_with_request_id(json_logs):
    res = TestClient(_mini_app(), raise_server_exceptions=False).get("/boom")
    assert res.status_code == 500

    (access,) = json_logs.of_type("access")
    assert access["level"] == "ERROR"
    assert access["status"] == 500
    (error,) = [r for r in json_logs.records() if r["message"] == "unhandled exception"]
    assert error["request_id"] == access["request_id"]
    assert "RuntimeError: boom for test" in error["exc_info"]


# --- 監査ログの部品 ----------------------------------------------------------


def test_email_hash_is_stable_and_case_insensitive(monkeypatch: pytest.MonkeyPatch):
    from app.config import settings

    first = email_hash("testuser_001@example.com")
    assert first == email_hash("  TestUser_001@Example.com ")
    assert len(first) == 16
    assert "testuser_001" not in first
    assert first != email_hash("testuser_002@example.com")

    # 鍵が違えば値も変わる（鍵を知らない人は突き合わせできない）。
    monkeypatch.setattr(settings, "LOG_HASH_SECRET", "another-test-only-secret")
    assert email_hash("testuser_001@example.com") != first


def test_audit_event_fields_and_levels(json_logs):
    audit_event("recipe.delete", "success", user_id="u-1", recipe_id="r-1")
    audit_event(
        "auth.login", "failure", reason="invalid_credentials", email="testuser_001@example.com"
    )

    (ok,) = json_logs.audit("recipe.delete")
    assert ok["level"] == "INFO"
    assert ok["outcome"] == "success"
    assert ok["user_id"] == "u-1"
    assert ok["recipe_id"] == "r-1"
    (ng,) = json_logs.audit("auth.login")
    assert ng["level"] == "WARNING"
    assert ng["reason"] == "invalid_credentials"
    assert ng["email_hash"] == email_hash("testuser_001@example.com")
    assert "testuser_001@example.com" not in json_logs.raw()


def test_audit_event_never_raises(monkeypatch: pytest.MonkeyPatch):
    """ログ出力が壊れても、呼び出し元（ログイン等）に例外を伝えない。"""
    import app.audit as audit_module

    def broken_log(*args: object, **kwargs: object) -> None:
        raise RuntimeError("log backend down")

    monkeypatch.setattr(audit_module.logger, "log", broken_log)
    audit_event("auth.logout", "success", user_id="u-1")  # 例外にならない
