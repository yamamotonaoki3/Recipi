"""通知のエンドポイント（features/notification.md §5）。すべて認証必要。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic.json_schema import SkipJsonSchema
from sqlmodel import Session

from app.db import get_session
from app.dependencies import get_current_user
from app.errors import ErrorEnvelope, validation_error
from app.models.user import User
from app.schemas.notification import (
    MarkReadRequest,
    NotificationListResponse,
    UnreadCountResponse,
)
from app.services import notification_feed

router = APIRouter(prefix="/api/v1", tags=["notifications"])


def _error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """openapi.json 用: 各エンドポイントが実際に返しうるエラーステータスを明示する。"""
    return {code: {"model": ErrorEnvelope} for code in status_codes}


async def _reject_null_body(request: Request) -> None:
    """body が JSON の `null` だけなら 400。

    FastAPI は「body なし」と「body が null」をどちらも None として渡してくるので、
    生の body を見て区別する。全件既読は取り消せないので、null を送り間違えただけで
    全部既読になる事故を防ぐ。body の読み取りは async でしかできないため依存性に
    分けている（Starlette が読んだ body を覚えているので、本体の検証とも両立する）。
    """
    raw = (await request.body()).strip()
    if raw == b"null":
        raise validation_error(
            "body に null は指定できません（全件既読は body を省略してください）"
        )


# 固定パスの `/notifications/unread-count` を先に宣言する。
@router.get("/notifications/unread-count", responses=_error_responses(401))
def get_unread_count(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UnreadCountResponse:
    """未読件数（バッジ用）。一覧の `unreadCount` と同じ値。"""
    return UnreadCountResponse(unread_count=notification_feed.count_unread(session, current_user))


@router.get("/notifications", responses=_error_responses(400, 401))
def list_notifications(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> NotificationListResponse:
    """自分あての通知を新しい順に返す（未読件数を同梱）。"""
    return notification_feed.list_notifications(session, current_user, cursor=cursor, limit=limit)


@router.post(
    "/notifications/read",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(400, 401),
    dependencies=[Depends(_reject_null_body)],
)
def mark_read(
    # null は `_reject_null_body` で 400 にするので、OpenAPI 上も null を許さない形にする。
    body: MarkReadRequest | SkipJsonSchema[None] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """既読にする。`ids` 省略（body ごと省略も可）で自分の通知をすべて既読に。"""
    ids = body.ids if body is not None else None
    notification_feed.mark_read(session, current_user, ids)
    # 依存性の自動コミットは応答の後になるので、返す前にコミットする（users.py と同じ）。
    session.commit()
    return None
