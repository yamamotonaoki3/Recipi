"""構造化ログ（JSON ログ）の設定。

方針（docs/requirements/non-functional.md §ログ / todo.md #44 / Issue #170）:
- Python 標準の `logging` に JSON フォーマッタ（python-json-logger）を差し込む。
- ログ 1 行 = 1 つの JSON オブジェクト。標準出力に書くだけにして、集約は
  実行基盤（本番は AWS の CloudWatch Logs を想定）に任せる。
- 全行に共通フィールドを付ける: `time`（UTC）/ `level` / `logger` / `message` /
  `request_id` / `user_id` / `service` / `env`。CloudWatch Logs Insights で
  `filter request_id = "..."` のように絞り込めるようにするため。
- パスワード・トークン等は `RedactFilter` で `[REDACTED]` に置き換える。

リクエストごとの値の受け渡し:
- `contextvars.ContextVar` に「今処理中のリクエストの情報」を入れておく。
  ContextVar はスレッド / 非同期タスクごとに別の値を持てる特別な変数。
- ミドルウェア（app/middleware.py）がリクエストのたびに値をセットする。
- ログを出すときに `RequestContextFilter` がその値を各ログレコードへ付ける。

user_id だけ「入れ物（dict）」にしている理由:
- FastAPI は同期の依存関数（`get_current_user`）をスレッドプールで動かす。
  そのとき ContextVar は「コピー」されるので、依存関数の中で `set()` しても、
  ミドルウェアやエンドポイント本体からは見えない。
- そこでミドルウェアが先に dict を 1 つ入れておき、依存関数はその dict の
  中身を書き換える。コピーされるのは「dict への参照」なので、書き換えは
  同じリクエストのどこからでも見える。
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Mapping
from contextvars import ContextVar, Token
from datetime import UTC, datetime
from typing import IO, Any

from pythonjsonlogger.json import JsonFormatter

# 「今処理しているリクエストの ID」を入れる箱。リクエスト外では "-"。
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

# 「今のリクエストの付加情報（user_id / client_ip）」を入れる dict。リクエスト外では None。
_request_info_ctx: ContextVar[dict[str, str] | None] = ContextVar("request_info", default=None)

# 値が無いときに入れる印（JSON で null より絞り込みやすいので文字列にする）。
_UNSET = "-"

# 全行に付ける固定値。ロググループを複数サービスで共有しても区別できるように。
SERVICE_NAME = "recipi-api"

# キー名にこれらを含む項目は、値を伏せて出す（大文字小文字は区別しない）。
_SENSITIVE_KEY_PARTS = (
    "password",
    "token",
    "authorization",
    "cookie",
    "secret",
    "security_answer",
)
REDACTED = "[REDACTED]"

# LogRecord が最初から持っている属性。これ以外が `extra=` で足された項目。
_STANDARD_RECORD_ATTRS = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime"}


# --- リクエストごとの値の出し入れ -------------------------------------------


def start_request_info(client_ip: str) -> Token[dict[str, str] | None]:
    """リクエストの開始時にミドルウェアから呼ぶ。戻り値は終了時に `reset` へ渡す。"""
    return _request_info_ctx.set({"user_id": _UNSET, "client_ip": client_ip})


def reset_request_info(token: Token[dict[str, str] | None]) -> None:
    """リクエストの終了時に、開始前の状態へ戻す。"""
    _request_info_ctx.reset(token)


def set_current_user_id(user_id: object) -> None:
    """認証が済んだユーザーの ID を、このリクエストのログに載せる。

    リクエストの外（定期ジョブ等）で呼ばれた場合は何もしない。
    """
    info = _request_info_ctx.get()
    if info is not None:
        info["user_id"] = str(user_id)


def current_user_id() -> str:
    info = _request_info_ctx.get()
    return info["user_id"] if info is not None else _UNSET


def current_client_ip() -> str:
    info = _request_info_ctx.get()
    return info["client_ip"] if info is not None else _UNSET


# --- フィルタ -----------------------------------------------------------------


class RequestContextFilter(logging.Filter):
    """すべてのログレコードに `time` / `request_id` / `user_id` を足すフィルタ。"""

    def filter(self, record: logging.LogRecord) -> bool:
        # LogRecord に無い属性を直接代入すると型チェッカーが嫌がるので、
        # フォーマッタが読む record.__dict__ に入れる（挙動は同じ）。
        # time は ISO 8601・UTC・ミリ秒まで（CloudWatch がそのまま解釈できる形）。
        record.__dict__["time"] = (
            datetime.fromtimestamp(record.created, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        record.__dict__["request_id"] = request_id_ctx.get()
        # 監査ログは `extra={"user_id": ...}` で対象ユーザーを明示することがある
        # （ログイン成功時など、まだ依存関数を通っていない場面）。その値を優先する。
        record.__dict__.setdefault("user_id", current_user_id())
        return True  # True を返す = そのログを出力する（捨てない）


def _redact(value: Any) -> Any:
    """dict / list の中まで見て、秘密っぽいキーの値を伏せる。"""
    if isinstance(value, Mapping):
        return {
            k: (REDACTED if _is_sensitive_key(str(k)) else _redact(v)) for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [_redact(v) for v in value]
    return value


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in _SENSITIVE_KEY_PARTS)


class RedactFilter(logging.Filter):
    """`extra=` で足された項目のうち、パスワード・トークン等の値を伏せるフィルタ。

    うっかり `logger.info("...", extra={"refresh_token": raw})` と書いても、
    ログには `[REDACTED]` しか残らないようにする安全網。本文（message）の
    文字列までは見ないので、そもそも秘密をメッセージに埋め込まないこと。
    """

    def filter(self, record: logging.LogRecord) -> bool:
        for key in list(record.__dict__):
            if key in _STANDARD_RECORD_ATTRS:
                continue
            if _is_sensitive_key(key):
                record.__dict__[key] = REDACTED
            else:
                record.__dict__[key] = _redact(record.__dict__[key])
        return True


# --- 初期化 -------------------------------------------------------------------


def build_handler(
    fmt: str = "json", *, stream: IO[str] | None = None, app_env: str | None = None
) -> logging.Handler:
    """フィルタとフォーマッタを付けた handler を作る（テストからも使う）。

    - `fmt`: "json" なら JSON 1 行、"text" なら人が読みやすい 1 行。
    - `stream`: 書き込み先。省略時は標準出力（アプリのログ出力先）。
    """
    # StreamHandler の既定値は標準エラー出力だが、要件ではログを標準出力に
    # 1 行 1 JSON で集約するため、省略時の出力先を明示的に標準出力にする。
    handler = logging.StreamHandler(sys.stdout if stream is None else stream)
    handler.addFilter(RequestContextFilter())
    handler.addFilter(RedactFilter())

    if fmt == "json":
        # 出力する JSON のキー。`%(...)s` は logging の項目名。
        handler.setFormatter(
            JsonFormatter(
                "%(time)s %(levelname)s %(name)s %(request_id)s %(user_id)s %(message)s",
                rename_fields={"levelname": "level", "name": "logger"},
                static_fields={
                    "service": SERVICE_NAME,
                    "env": app_env or os.environ.get("APP_ENV", "development"),
                },
                # 日本語をエスケープ（\uXXXX）せずそのまま出す（人が読めるように）。
                json_ensure_ascii=False,
            )
        )
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(time)s [%(levelname)s] %(name)s (%(request_id)s user=%(user_id)s) %(message)s"
            )
        )
    return handler


def configure_logging(level: str = "INFO", fmt: str = "json", app_env: str | None = None) -> None:
    """アプリ起動時に 1 回呼んでロギングを初期化する。

    - `level`: "DEBUG" / "INFO" など。本番・開発とも既定は INFO。
    - `fmt`: "json" / "text"。
    - `app_env`: 全行に付ける `env` の値。省略時は環境変数 APP_ENV。
    """
    root = logging.getLogger()
    root.handlers.clear()  # 既存の handler を消してから付け直す（二重出力を防ぐ）
    root.addHandler(build_handler(fmt, app_env=app_env))
    root.setLevel(level.upper())

    # warnings.warn() は通常の logging 呼び出しを経ず標準エラー出力へ出るため、
    # py.warnings ロガーへ渡して、アプリのログと同じ JSON 形式で記録する。
    logging.captureWarnings(True)

    # uvicorn は起動時に自前の handler（JSON ではない形式）を付けている。
    # それを外して root に流し、uvicorn 自身のログ（起動・停止・エラー）も
    # 同じ JSON 形式にそろえる。
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True

    # uvicorn のアクセスログは、app/middleware.py のアクセスログ（user_id や
    # 処理時間を含む）で置き換えるので止める（1 リクエストで 2 行出ないように）。
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers.clear()
    access_logger.propagate = False
    access_logger.disabled = True
