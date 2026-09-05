"""FastAPI の `Depends` で使う共通の依存性。

`get_current_user` を `Depends(get_current_user)` としてルーターの引数に
書くと、そのエンドポイントは「有効なアクセストークンを持つリクエストだけ」
実行されるようになる（無効なら中で 401 を送出するので、ルーター本体の
コードは「ログイン済みユーザーがいる」前提で書ける）。
"""

from __future__ import annotations

import uuid

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.db import get_session
from app.errors import unauthorized
from app.models.user import User
from app.security import InvalidAccessTokenError, decode_access_token

# `HTTPBearer` は `Authorization: Bearer <token>` ヘッダーからトークン文字列を
# 取り出してくれる FastAPI 標準の仕組み。ヘッダーが無ければ自動で 403 を返すが、
# ここでは auto_error=False にして、無い場合も自前で 401（UNAUTHORIZED）に
# 統一する（api.md のエラー形式に合わせるため）。
_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: Session = Depends(get_session),
) -> User:
    """アクセストークンを検証し、対応する `User` を返す。無効なら 401。

    token_version の突き合わせが重要: JWT の署名が正しくても、DB 上の
    `users.token_version` が発行時と変わっていたら（＝パスワードリセット等で
    インクリメントされていたら）無効なトークンとして扱う。これにより、
    有効期限が切れていない古いアクセストークンも即座に使えなくできる。
    """
    if credentials is None:
        raise unauthorized()

    try:
        payload = decode_access_token(credentials.credentials)
    except InvalidAccessTokenError as exc:
        raise unauthorized() from exc

    try:
        user_id = uuid.UUID(payload["sub"])
    except ValueError as exc:
        raise unauthorized() from exc

    user = session.get(User, user_id)
    if user is None or user.token_version != payload["token_version"]:
        raise unauthorized()

    return user
