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
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from app import storage
from app.ai import warm_local_ollama
from app.api.ai import router as ai_router
from app.api.auth import router as auth_router
from app.api.client_config import router as client_config_router
from app.api.comments import router as comments_router
from app.api.images import router as images_router
from app.api.notifications import router as notifications_router
from app.api.recipes import router as recipes_router
from app.api.units import router as units_router
from app.api.users import router as users_router
from app.config import settings
from app.db import check_db_connection
from app.errors import AppError
from app.logging_config import configure_logging
from app.middleware import RequestIdMiddleware
from app.startup import apply_development_migrations

configure_logging(level=settings.LOG_LEVEL, fmt=settings.LOG_FORMAT, app_env=settings.APP_ENV)
logger = logging.getLogger("app")


def should_initialize_local_storage(app_env: str) -> bool:
    """MinIO を初期化するローカル開発環境かを返す。"""
    return app_env == "development"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """アプリ起動時に開発用 DB / AI / ローカルストレージを初期化する。

    production では呼ばない（Issue #166）。本番のバケットは Terraform が用意し、
    CloudFront（OAC）経由でだけ読めるよう非公開にしている。demo でも呼ばない。
    デモの MinIO バケットと画像は seed スクリプトが明示的に作成・投入するため、
    起動処理が ensure_bucket() を実行する必要はない。
    """
    if settings.APP_ENV == "development":
        # 開発 DB だけを常に head にし、未適用 migration による実行時エラーを防ぐ。
        # 失敗は起動失敗として扱う（古いスキーマで API を提供しない）。
        apply_development_migrations()
        # Ollama の停止は任意機能である AI 校正だけに影響させる。
        warm_local_ollama()

    if should_initialize_local_storage(settings.APP_ENV):
        try:
            storage.ensure_bucket()
        except Exception:
            # MinIO が起動していないなどの初期化失敗だけで、API 全体を起動不能にしない。
            logger.warning("ストレージのバケット初期化に失敗しました", exc_info=True)
    yield


app = FastAPI(
    title="Recipi API",
    version="0.1.0",
    # OpenAPI のパスは /api/v1 配下（api.md）。scaffold では docs だけ用意。
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

# CORS: Web（Expo）/ Tauri はページと API のオリジンが違うので許可が要る。
# 許可するオリジンは環境変数 CORS_ALLOW_ORIGINS（カンマ区切り）で設定する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_web_origin(request: Request, call_next: Any) -> Any:
    """Cookie認証を使うブラウザの状態変更を許可Originに限定する。"""
    origin = request.headers.get("origin")
    if origin and request.method not in {"GET", "HEAD", "OPTIONS"}:
        if origin not in settings.cors_allow_origins:
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "許可されていないOriginです",
                        "details": None,
                    }
                },
            )
    return await call_next(request)


# リクエスト ID ＋ アクセスログのミドルウェアは「最後に」登録する。
# Starlette では後から登録したミドルウェアほど外側で動くので、こうすると
# 上の Origin チェック（403）や CORS の応答も含め、すべてのリクエストが
# アクセスログに 1 行ずつ残る（Issue #170）。
app.add_middleware(RequestIdMiddleware)


def _cors_error_headers(request: Request) -> dict[str, str]:
    """エラーハンドラから返すCORSヘッダー。

    通常の成功レスポンスはCORSMiddlewareが付与するが、例外処理の経路では
    Starletteの外側の例外ミドルウェアがレスポンスを生成する場合があるため、
    ブラウザ向けエラーにも明示的に付与する。
    """
    origin = request.headers.get("origin")
    if origin and origin in settings.cors_allow_origins:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return {}


@app.exception_handler(AppError)
def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    """`AppError`（とそのファクトリ関数）を api.md の統一エラー形式に変換する。"""
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_envelope(),
        headers=_cors_error_headers(request),
    )


_VALIDATION_FIELD_LABELS = {
    "email": "メールアドレス",
    "password": "パスワード",
    "currentPassword": "現在のパスワード",
    "newPassword": "新しいパスワード",
    "displayName": "表示名",
    "securityQuestion": "秘密の質問",
    "securityAnswer": "答え",
    "rememberMe": "ログイン状態の保持",
    "title": "タイトル",
    "description": "説明",
    "servings": "何人分",
    "ingredientGroups": "材料グループ",
    "ingredients": "材料",
    "steps": "手順",
    "body": "本文",
    "imageKey": "画像",
    "feed": "フィード",
    "q": "検索語",
    "cursor": "ページングカーソル",
    "limit": "件数",
    "ids": "通知ID",
    "recipeId": "レシピID",
    "userId": "ユーザーID",
    "commentId": "感想ID",
    "items": "項目",
}


def _validation_field(loc: tuple[Any, ...] | list[Any]) -> str:
    """エラー位置から利用者向けの項目名を取り出す。"""
    for part in reversed(loc):
        if isinstance(part, str) and part not in {"body", "query", "path", "header", "cookie"}:
            return part.replace("_", " ") if "_" in part else part
    return "入力項目"


def _validation_label(field: str) -> str:
    camel = "".join(
        word if index == 0 else word[:1].upper() + word[1:]
        for index, word in enumerate(field.split(" "))
    )
    return _VALIDATION_FIELD_LABELS.get(field, _VALIDATION_FIELD_LABELS.get(camel, field))


def _validation_context_number(error: dict[str, Any], key: str) -> str | None:
    value = error.get("ctx", {}).get(key)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _localized_validation_message(error: dict[str, Any]) -> str:
    """Pydanticのエラーを、入力値を含めず日本語へ変換する。"""
    error_type = str(error.get("type", ""))
    field = _validation_field(error.get("loc", []))
    label = _validation_label(field)
    original = str(error.get("msg", ""))

    # 独自バリデータの日本語は、Pydanticの接頭辞だけ外してそのまま使う。
    custom = original.removeprefix("Value error, ")
    if any("\u3000" <= char <= "\u9fff" for char in custom):
        return custom

    if "email" in original.lower() or error_type in {"email_parsing", "value_error.email"}:
        return "有効なメールアドレスを入力してください"
    if error_type == "missing":
        return f"{label}を入力してください"
    if error_type in {"none_required", "string_type", "int_type", "float_type", "bool_type"}:
        return f"{label}の入力形式が不正です"
    if error_type == "string_too_short":
        minimum = _validation_context_number(error, "min_length")
        if minimum:
            return f"{label}は{minimum}文字以上で入力してください"
        return f"{label}の文字数を確認してください"
    if error_type == "string_too_long":
        maximum = _validation_context_number(error, "max_length")
        if maximum:
            return f"{label}は{maximum}文字以内で入力してください"
        return f"{label}の文字数を確認してください"
    if error_type == "greater_than_equal":
        minimum = _validation_context_number(error, "ge")
        if minimum:
            return f"{label}は{minimum}以上で指定してください"
        return f"{label}の範囲を確認してください"
    if error_type == "greater_than":
        minimum = _validation_context_number(error, "gt")
        if minimum:
            return f"{label}は{minimum}より大きい値で指定してください"
        return f"{label}の範囲を確認してください"
    if error_type == "less_than_equal":
        maximum = _validation_context_number(error, "le")
        if maximum:
            return f"{label}は{maximum}以下で指定してください"
        return f"{label}の範囲を確認してください"
    if error_type == "less_than":
        maximum = _validation_context_number(error, "lt")
        if maximum:
            return f"{label}は{maximum}未満で指定してください"
        return f"{label}の範囲を確認してください"
    if error_type == "too_short":
        minimum = _validation_context_number(error, "min_length")
        if minimum:
            return f"{label}は{minimum}件以上指定してください"
        return f"{label}の件数を確認してください"
    if error_type == "too_long":
        maximum = _validation_context_number(error, "max_length")
        if maximum:
            return f"{label}は{maximum}件以内で指定してください"
        return f"{label}の件数を確認してください"
    if error_type in {"uuid_parsing", "uuid_type"}:
        return f"{label}の形式が不正です"
    if error_type in {"int_parsing", "float_parsing", "finite_number"}:
        return f"{label}は数値で指定してください"
    if error_type == "bool_parsing":
        return f"{label}は真偽値で指定してください"
    if error_type in {"list_type", "dict_type", "mapping_type"}:
        return f"{label}の入力形式が不正です"
    if error_type in {"literal_error", "enum"}:
        return f"{label}の指定が不正です"
    return f"{label}の入力内容を確認してください"


def _safe_validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """入力値やPydantic内部情報を除いた安定したエラー配列を作る。"""
    return [
        {
            "loc": list(error.get("loc", [])),
            "msg": _localized_validation_message(error),
            "type": str(error.get("type", "validation_error")),
        }
        for error in exc.errors()
    ]


@app.exception_handler(RequestValidationError)
def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI 標準のバリデーションエラー（デフォルト 422）を 400 に統一する。"""
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "リクエストの内容が不正です",
                "details": {"errors": jsonable_encoder(_safe_validation_errors(exc))},
            }
        },
        headers=_cors_error_headers(request),
    )


@app.exception_handler(PoolTimeoutError)
def handle_db_pool_timeout(request: Request, exc: PoolTimeoutError) -> JSONResponse:
    """DB の接続プールが空くのを待ちきれなかったら 503 を返す（Issue #191）。

    サーバーのバグではなく「今は同時に捌ける量を超えている」という状態なので、
    500（サーバー内部エラー）ではなく 503（一時的に利用できない）を返し、
    `Retry-After` で再試行の目安を伝える。待たせ続けるとスレッドが占有され、
    クライアントからは「応答が返ってこない」のと同じになる（Issue #189 の実測では、
    サーバーが 500 を 129 件返した一方、クライアントが受け取れたのは 26 件だった）。

    このハンドラは `Exception` のハンドラと違い、リクエスト ID のミドルウェアの
    **内側**で動く。そのため middleware.py の `unhandled exception`（スタック
    トレース付き）は出ず、想定内の輻輳として WARNING が 1 行残るだけになる。
    CloudWatch のメトリクスフィルタ（infra/terraform/monitoring.tf）で
    `unhandled exception` を数えているので、この違いがそのまま
    「バグによる 500」と「意図した縮退」の区別になる。
    """
    logger.warning("db pool timeout", extra={"path": request.url.path})
    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "code": "SERVICE_UNAVAILABLE",
                "message": "混み合っています。しばらくしてからもう一度お試しください",
                "details": None,
            }
        },
        headers={"Retry-After": "1", **_cors_error_headers(request)},
    )


@app.exception_handler(Exception)
def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    """想定外の例外は 500 + INTERNAL にする（詳細はログにのみ出す）。

    スタックトレースのログは app/middleware.py が request_id 付きで出す。
    このハンドラはミドルウェアの外側で動くため、ここでは出さない（二重に出さない）。
    """
    return JSONResponse(
        status_code=500,
        content={
            "error": {"code": "INTERNAL", "message": "サーバー内部エラーです", "details": None}
        },
        headers=_cors_error_headers(request),
    )


app.include_router(auth_router)
app.include_router(client_config_router)
app.include_router(ai_router)
app.include_router(users_router)
app.include_router(recipes_router)
app.include_router(units_router)
app.include_router(images_router)
app.include_router(comments_router)
app.include_router(notifications_router)


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
