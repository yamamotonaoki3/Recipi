"""FastAPI アプリの入口。

`uvicorn app.main:app` の `app` がこのファイルの `app` 変数を指す。

やっていること（Phase 0 の scaffold）:
- ロギングを初期化
- リクエスト ID ミドルウェア ＋ CORS を登録
- ヘルスチェック用のエンドポイントを 2 つ用意
  - GET /healthz     … プロセスが生きているか（liveness）
  - GET /healthz/db  … DB につながるか（readiness）

実際の機能（認証・レシピ等）は Phase 1 以降で `app/api/` などを足していく。
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import check_db_connection
from app.logging_config import configure_logging
from app.middleware import RequestIdMiddleware

configure_logging(level=settings.LOG_LEVEL, fmt=settings.LOG_FORMAT)
logger = logging.getLogger("app")

app = FastAPI(
    title="Recipi API",
    version="0.1.0",
    # OpenAPI のパスは /api/v1 配下（api.md）。scaffold では docs だけ用意。
    openapi_url="/api/v1/openapi.json",
)
app.add_middleware(RequestIdMiddleware)

# CORS: Web（Expo）/ Tauri はページと API のオリジンが違うので許可が要る。
# 許可するオリジンは環境変数 CORS_ALLOW_ORIGINS（カンマ区切り）で設定する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", tags=["health"], summary="プロセスの生存確認")
def healthz() -> dict[str, str]:
    """プロセスが起動していれば 200 を返すだけの軽いエンドポイント。"""
    return {"status": "ok", "env": settings.APP_ENV}


@app.get("/healthz/db", tags=["health"], summary="DB への疎通確認")
def healthz_db() -> dict[str, str]:
    """DB に `SELECT 1` できるかを返す。つながらなくても例外にはしない。"""
    ok = check_db_connection()
    logger.info("db health check", extra={"db_ok": ok})
    return {"database": "ok" if ok else "unavailable"}
