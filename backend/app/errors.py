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


def reauth_failed(message: str = "現在のパスワードが正しくありません") -> AppError:
    """認証情報を変更する操作で、現パスワードによる再認証に失敗したとき。

    **401 にしてはいけない**。`expoApp/src/api/client.ts` は 401 を
    「アクセストークンが切れた」と解釈してリフレッシュ → 同じリクエストを再送し、
    それでも 401 ならセッションを破棄する。現パスワードの打ち間違いで 401 を
    返すと、利用者が 1 文字間違えただけでログアウトさせられてしまう。
    クライアントはステータスコードで分岐するため、メッセージだけ変えても直らない。

    「認証は済んでいるが、この操作に必要な追加の証明に失敗した」という意味で
    403 を使い、権限不足の `FORBIDDEN` とはコードで区別する。
    """
    return AppError(403, "REAUTH_FAILED", message)


def not_found(message: str = "対象が見つかりません") -> AppError:
    return AppError(404, "NOT_FOUND", message)


def conflict(message: str) -> AppError:
    return AppError(409, "CONFLICT", message)


def account_deactivated() -> AppError:
    """正しい認証情報で退会済みアカウントを検出したときの再開確認用エラー。"""
    return AppError(
        409, "ACCOUNT_DEACTIVATED", "アカウントは退会中です。再開するには確認してください。"
    )


def too_many_requests(message: str = "試行回数が多すぎます") -> AppError:
    return AppError(429, "TOO_MANY_REQUESTS", message)


def unavailable(message: str = "サービスを一時的に利用できません") -> AppError:
    return AppError(503, "AI_UNAVAILABLE", message)
