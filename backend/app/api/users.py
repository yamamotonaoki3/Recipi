"""`/api/v1/users/*` エンドポイント（Phase 1 では自分の表示名変更のみ）。

書き込みを終えたら `return` する前に必ず `session.commit()` する理由は
`app/api/auth.py` 冒頭のコメントを参照（FastAPI の `Depends(yield)` は
レスポンス送信後に後始末コードを実行するため、自動コミットに任せると
「クライアントが成功レスポンスを受け取った直後の別リクエストがまだ古い
状態を見てしまう」競合が起きうる）。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db import get_session
from app.dependencies import get_current_user
from app.errors import ErrorEnvelope
from app.models.user import User
from app.schemas.recipe import HistoryResponse
from app.schemas.user import UpdateMeRequest, UserMeResponse
from app.services import history as history_service

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


@router.get("/me/history", responses={400: {"model": ErrorEnvelope}, 401: {"model": ErrorEnvelope}})
def get_my_history(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> HistoryResponse:
    """最近見たレシピ一覧（features/view-history.md §5）。読み取りのみ。"""
    return history_service.list_history(session, current_user, cursor=cursor, limit=limit)


@router.delete(
    "/me/history",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"model": ErrorEnvelope}},
)
def delete_my_history(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """閲覧履歴を全消去する（features/view-history.md §5）。

    書き込みなので、レスポンスを返す前に明示的に commit する（ファイル冒頭コメント）。
    """
    history_service.clear_history(session, current_user)
    session.commit()
    return None
