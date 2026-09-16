"""HTTP リクエストごとに共通で行う処理（ミドルウェア）。

ここで行うこと:
- リクエスト ID の付与: リクエストごとにユニークな ID を作る（クライアントが
  `X-Request-ID` ヘッダを送ってきて、形式が安全ならそれを使う）。
  その ID を `request_id_ctx`（ContextVar）へ入れる → 以降、そのリクエスト
  処理中に出るログすべてに同じ ID が付く。レスポンスヘッダにも返す。
- アクセスログ: 1 リクエストにつき 1 行、`log_type="access"` のログを出す
  （Issue #170）。uvicorn 標準のアクセスログの代わり。
- 想定外の例外のログ: request_id を付けたまま、ここでスタックトレースを出す
  （main.py の 500 ハンドラはこのミドルウェアの外側で動くため、そこで
  ログを出すと request_id が付かない）。
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.db_metrics import db_metrics, reset_db_metrics, start_db_metrics
from app.logging_config import request_id_ctx, reset_request_info, start_request_info
from app.request_utils import client_ip

access_logger = logging.getLogger("app.access")
logger = logging.getLogger("app")

# 外から受け取る X-Request-ID の許可形式。改行や巨大な文字列をそのまま
# ログに書くと、偽のログ行を混ぜ込まれる（ログインジェクション）おそれがある。
_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")

# ヘルスチェックは数秒おきに叩かれてログが埋まるので DEBUG で出す（INFO では出ない）。
_HEALTH_CHECK_PREFIX = "/healthz"

# User-Agent は長い値を送られてもログが膨らまないように切り詰める。
_USER_AGENT_MAX_LENGTH = 256


def _request_id_from(request: Request) -> str:
    """クライアントの ID が安全な形式ならそれを使い、そうでなければ新しく発行する。"""
    incoming = request.headers.get("X-Request-ID")
    if incoming is not None and _REQUEST_ID_PATTERN.fullmatch(incoming):
        return incoming
    return uuid.uuid4().hex


def _route_path(request: Request) -> str:
    """ログに出すパス。ルートのテンプレート（例: /api/v1/recipes/{recipe_id}）を優先する。

    テンプレートにしておくと、CloudWatch Logs Insights で「エンドポイントごとの
    件数・処理時間」を集計できる（実際の ID ごとにばらけない）。どのルートにも
    一致しなかった場合（404 など）は実際のパスを使う。クエリ文字列は検索語などの
    個人情報を含みうるので、どちらの場合も出さない。
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else request.url.path


def _access_log_level(path: str, status_code: int) -> int:
    if path.startswith(_HEALTH_CHECK_PREFIX):
        return logging.DEBUG
    if status_code >= 500:
        return logging.ERROR
    if status_code >= 400:
        return logging.WARNING
    return logging.INFO


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = _request_id_from(request)

        # ContextVar にセットすると、この後の処理（ログ含む）で参照できる。
        # set() は「元の状態に戻すためのトークン」を返すので、finally で戻す。
        request_id_token = request_id_ctx.set(request_id)
        info_token = start_request_info(client_ip(request))
        db_metrics_token = start_db_metrics()
        started = time.perf_counter()
        status_code = 500  # 例外で抜けた場合は 500 として記録する
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            logger.exception("unhandled exception")
            raise
        finally:
            # ContextVar を戻す「前」に出す（request_id / user_id を載せるため）。
            path = _route_path(request)
            access_logger.log(
                _access_log_level(path, status_code),
                "%s %s %d",
                request.method,
                path,
                status_code,
                extra={
                    "log_type": "access",
                    "method": request.method,
                    "path": path,
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "db_query_count": db_metrics()["query_count"],
                    "db_duration_ms": db_metrics()["duration_ms"],
                    "client_ip": client_ip(request),
                    "user_agent": request.headers.get("user-agent", "")[:_USER_AGENT_MAX_LENGTH],
                },
            )
            reset_request_info(info_token)
            reset_db_metrics(db_metrics_token)
            request_id_ctx.reset(request_id_token)

        response.headers["X-Request-ID"] = request_id
        return response
