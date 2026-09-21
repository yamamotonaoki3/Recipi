"""リフレッシュトークンを「どう運ぶか」を決める処理（Issue #241 で切り出し）。

Web（ブラウザ）だけは HttpOnly Cookie で運び、それ以外（ネイティブ / Tauri）は
レスポンス本文で渡す。この判定と Cookie の属性は、リフレッシュトークンを発行する
すべてのエンドポイントで揃っている必要があるため、1 か所にまとめる。

元は `app/api/auth.py` のモジュール私有だったが、`PUT /users/me/email`
（app/api/users.py）でも同じ扱いが要るようになったので出した。**挙動は変えていない。**

Cookie の `Path` は `settings.AUTH_COOKIE_PATH`（`/api/v1/auth`）のまま。変えると
既存クライアントが持っている Cookie が届かなくなり、セッションが切れる。
`/api/v1/users/me/email` から `/api/v1/auth` 宛の Cookie を**設定する**のは問題ない
（Set-Cookie の Path は、送る側のパスと一致している必要がない）。
"""

from __future__ import annotations

from fastapi import Request, Response

from app.config import settings


def is_web_request(request: Request) -> bool:
    """ブラウザ由来のリクエストだけ Cookie 方式を有効にする。"""
    # Tauri の開発時は画面を Expo dev server（http://localhost:8081）から
    # 読み込むため、Origin だけでは通常ブラウザと区別できない。そのままだと
    # refresh token を HttpOnly Cookie にしか入れず、Stronghold へ空文字を
    # 保存して再起動後の復元が 401 になる。Tauri クライアントだけが付ける
    # 印は開発・テスト環境でのみ受け入れる。本番は Tauri の tauri:// Origin
    # 自体が Cookie 対象外であり、任意ヘッダーで token を露出させない。
    if (
        settings.APP_ENV != "production"
        and request.headers.get("x-recipi-auth-transport") == "token"
    ):
        return False
    origin = request.headers.get("origin")
    return (
        origin is not None
        and origin.startswith(("http://", "https://"))
        and origin in settings.cors_allow_origins
    )


def set_refresh_cookie(response: Response, token: str, remember_me: bool) -> None:
    """Web 用 refresh token Cookie を設定する。"""
    max_age = settings.REFRESH_TOKEN_TTL_DAYS * 86400 if remember_me else None
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path=settings.AUTH_COOKIE_PATH,
    )


def delete_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path=settings.AUTH_COOKIE_PATH,
    )
