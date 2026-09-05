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
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.config import settings
from app.db import check_db_connection
from app.errors import AppError
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


@app.exception_handler(AppError)
def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    """`AppError`（とそのファクトリ関数）を api.md の統一エラー形式に変換する。"""
    return JSONResponse(status_code=exc.status_code, content=exc.to_envelope())


@app.exception_handler(RequestValidationError)
def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI 標準のバリデーションエラー（デフォルト 422）を 400 に統一する。"""
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "リクエストの内容が不正です",
                "details": {"errors": jsonable_encoder(exc.errors())},
            }
        },
    )


@app.exception_handler(Exception)
def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    """想定外の例外は 500 + INTERNAL にする（詳細はログにのみ出す）。"""
    logger.exception("unhandled exception")
    return JSONResponse(
        status_code=500,
        content={
            "error": {"code": "INTERNAL", "message": "サーバー内部エラーです", "details": None}
        },
    )


app.include_router(auth_router)
app.include_router(users_router)


def _custom_openapi() -> dict[str, Any]:
    """`openapi.json` 上のバリデーションエラー応答を実際の挙動（400）に合わせる。

    FastAPI は標準では「リクエストの形式が不正」なら 422 を返す前提で
    OpenAPI を生成するが、上の `handle_validation_error` で実際には 400 +
    共通エラー形式に変換している。生成される openapi.json（→ フロントの型）が
    実際のレスポンスと食い違わないよう、ここで 422 を 400 に置き換える。
    """
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
        openapi_version=app.openapi_version,
    )
    schema.setdefault("components", {}).setdefault("schemas", {})["ErrorEnvelope"] = {
        "type": "object",
        "required": ["error"],
        "properties": {
            "error": {
                "type": "object",
                "required": ["code", "message"],
                "properties": {
                    "code": {"type": "string"},
                    "message": {"type": "string"},
                    "details": {"type": "object", "nullable": True},
                },
            }
        },
    }
    error_response = {
        "description": "リクエストの内容が不正です",
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}},
    }
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            responses = operation.get("responses")
            if responses and "422" in responses:
                del responses["422"]
                responses["400"] = error_response

    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _custom_openapi  # type: ignore[method-assign]


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
