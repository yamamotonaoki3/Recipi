"""`/api/v1/users/*` エンドポイント（Phase 1 では自分の表示名変更のみ）。

書き込みを終えたら `return` する前に必ず `session.commit()` する理由は
`app/api/auth.py` 冒頭のコメントを参照（FastAPI の `Depends(yield)` は
レスポンス送信後に後始末コードを実行するため、自動コミットに任せると
「クライアントが成功レスポンスを受け取った直後の別リクエストがまだ古い
状態を見てしまう」競合が起きうる）。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.db import get_session
from app.dependencies import get_current_user
from app.errors import ErrorEnvelope
from app.models.user import User
from app.schemas.user import UpdateMeRequest, UserMeResponse

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.patch("/me", responses={401: {"model": ErrorEnvelope}})
def update_me(
    body: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserMeResponse:
    current_user.display_name = body.display_name
    current_user.updated_at = datetime.now(UTC)
    session.add(current_user)
    session.commit()
    return UserMeResponse(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
    )
