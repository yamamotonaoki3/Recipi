"""HTTP リクエストごとに共通で行う処理（ミドルウェア）。

ここでは「リクエスト ID の付与」だけを行う:
- リクエストごとにユニークな ID を作る（クライアントが `X-Request-ID`
  ヘッダを送ってきたらそれを使う）。
- その ID を `request_id_ctx`（ContextVar）へ入れる。
  → 以降、そのリクエスト処理中に出るログすべてに同じ ID が付く。
- レスポンスヘッダにも `X-Request-ID` を返す（クライアント側で照合できる）。
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.logging_config import request_id_ctx


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # クライアントが送ってきた ID があれば流用、無ければ新規発行。
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex

        # ContextVar にセットすると、この後の処理（ログ含む）で参照できる。
        # set() は「元の状態に戻すためのトークン」を返すので、finally で戻す。
        token = request_id_ctx.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)

        response.headers["X-Request-ID"] = request_id
        return response
