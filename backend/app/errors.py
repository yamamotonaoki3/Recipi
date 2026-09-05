"""API 共通のエラーレスポンス。

api.md の統一エラー形式 `{"error": {"code", "message", "details"}}` を
どのエンドポイントからでも同じ形で返せるようにする。

ルーターは `HTTPException` ではなくここで定義する `AppError`（のサブクラス）
を送出する。`app/main.py` に登録した例外ハンドラが `AppError` を
JSON レスポンスに変換する。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorEnvelope(BaseModel):
    """api.md の統一エラー形式に対応する Pydantic モデル。

    ルーターの `responses={...}` にこのモデルを渡すことで、各エンドポイントが
    実際に返しうるエラーステータス（401/404/409/429 等）を openapi.json に
    正しく記載する（そうしないと FastAPI は 422 以外のエラー応答を
    自動では文書化しないため、生成されるフロントの型からエラー分岐が
    抜け落ちてしまう）。
    """

    error: ErrorDetail


class AppError(Exception):
    """API のエラーレスポンスに変換される例外の基底クラス。"""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details

    def to_envelope(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


def validation_error(message: str, details: dict[str, Any] | None = None) -> AppError:
    return AppError(400, "VALIDATION_ERROR", message, details)


def unauthorized(message: str = "認証に失敗しました") -> AppError:
    return AppError(401, "UNAUTHORIZED", message)


def forbidden(message: str = "この操作を行う権限がありません") -> AppError:
    return AppError(403, "FORBIDDEN", message)


def not_found(message: str = "対象が見つかりません") -> AppError:
    return AppError(404, "NOT_FOUND", message)


def conflict(message: str) -> AppError:
    return AppError(409, "CONFLICT", message)


def too_many_requests(message: str = "試行回数が多すぎます") -> AppError:
    return AppError(429, "TOO_MANY_REQUESTS", message)
