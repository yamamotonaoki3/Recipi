"""構造化ログ（JSON ログ）の設定。

方針（docs/requirements/non-functional.md / todo.md #44）:
- Phase 0 は Python 標準の `logging` に JSON フォーマッタ（python-json-logger）
  を差し込む「従来方式」。
- ログ 1 行 = 1 つの JSON オブジェクト。`request_id` を必ず含める。
- あとで structlog を導入する場合も、この handler / formatter の構成を
  流用できる（structlog が標準 logging をラップできる）。

`request_id` の受け渡し:
- `contextvars.ContextVar` に「今処理中のリクエスト ID」を入れておく。
  ContextVar はスレッド / 非同期タスクごとに別の値を持てる特別な変数。
- ミドルウェア（app/middleware.py）がリクエストのたびに値をセットする。
- ログを出すときに `RequestIdFilter` がその値を各ログレコードへ付ける。
"""

from __future__ import annotations

import logging
from contextvars import ContextVar

from pythonjsonlogger.json import JsonFormatter

# 「今処理しているリクエストの ID」を入れる箱。リクエスト外では "-"。
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    """すべてのログレコードに `request_id` を足すフィルタ。"""

    def filter(self, record: logging.LogRecord) -> bool:
        # LogRecord に無い属性を直接代入すると型チェッカーが嫌がるので、
        # フォーマッタが読む record.__dict__ に入れる（挙動は同じ）。
        record.__dict__["request_id"] = request_id_ctx.get()
        return True  # True を返す = そのログを出力する（捨てない）


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    """アプリ起動時に 1 回呼んでロギングを初期化する。

    - `level`: "DEBUG" / "INFO" など。
    - `fmt`: "json" なら JSON 1 行、"text" なら人が読みやすい 1 行。
    """
    handler = logging.StreamHandler()  # 標準出力へ書く
    handler.addFilter(RequestIdFilter())

    if fmt == "json":
        # 出力する JSON のキー。`%(...)s` は logging の項目名。
        handler.setFormatter(
            JsonFormatter(
                "%(asctime)s %(levelname)s %(name)s %(request_id)s %(message)s",
                rename_fields={"asctime": "time", "levelname": "level", "name": "logger"},
            )
        )
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s (%(request_id)s) %(message)s")
        )

    root = logging.getLogger()
    root.handlers.clear()  # 既存の handler を消してから付け直す（二重出力を防ぐ）
    root.addHandler(handler)
    root.setLevel(level.upper())
