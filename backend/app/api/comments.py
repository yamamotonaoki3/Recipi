"""感想（コメント）のエンドポイント（features/comment.md §5）。

書き込みは `run_with_retry()` で包み、commit まで済ませてから応答を返す
（同じレシピへの同時投稿で起きうるデッドロック等はサーバー側でやり直す）。

## エラーの判定順

1. リクエストの形の不正（本文の長さ・`{}` の PATCH など）→ 400
   ※ FastAPI がサービスを呼ぶ前に検証するので、これが一番先に返る
2. レシピ / 感想が見えない（存在しない・他人の非公開）→ 404
3. 権限が無い（自分のレシピへの投稿・他人の感想の編集など）→ 403
4. 画像キーの不正（他人のキー・使用済み）→ 400
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db import get_session, run_with_retry
from app.dependencies import get_current_user, get_current_user_optional
from app.errors import ErrorEnvelope
from app.models.user import User
from app.schemas.comment import (
    CommentCreateRequest,
    CommentListResponse,
    CommentResponse,
    CommentUpdateRequest,
)
from app.services import comment as comment_service

router = APIRouter(prefix="/api/v1", tags=["comments"])


def _error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """openapi.json 用: 各エンドポイントが実際に返しうるエラーステータスを明示する。"""
    return {code: {"model": ErrorEnvelope} for code in status_codes}


@router.get(
    "/recipes/{recipe_id}/comments",
    responses=_error_responses(400, 401, 404),
    # 認証は任意（公開レシピの感想は匿名でも見られる）。既存の GET /recipes/{id} と同じく、
    # "認証なし"（{}）を選択肢に加えて、OpenAPI 上も任意と分かるようにする。
    openapi_extra={"security": [{}, {"HTTPBearer": []}]},
)
def list_comments(
    recipe_id: uuid.UUID,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User | None = Depends(get_current_user_optional),
    session: Session = Depends(get_session),
) -> CommentListResponse:
    """そのレシピの感想を新しい順に返す。他人の非公開レシピは 404。"""
    return comment_service.list_comments(
        session, current_user, recipe_id, cursor=cursor, limit=limit
    )


@router.post(
    "/recipes/{recipe_id}/comments",
    status_code=status.HTTP_201_CREATED,
    responses=_error_responses(400, 401, 403, 404),
)
def create_comment(
    recipe_id: uuid.UUID,
    body: CommentCreateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CommentResponse:
    """感想を投稿する（レシピ投稿者本人は 403）。"""
    comment = run_with_retry(
        session, lambda: comment_service.create_comment(session, current_user, recipe_id, body)
    )
    # commit 済み。応答は DB に入った値（created_at など）で組み立てる。
    session.refresh(comment)
    return comment_service.to_response(comment, current_user)


@router.patch("/comments/{comment_id}", responses=_error_responses(400, 401, 403, 404))
def update_comment(
    comment_id: uuid.UUID,
    body: CommentUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CommentResponse:
    """自分の感想の本文・画像を変える（送られた項目だけ）。"""
    comment = run_with_retry(
        session, lambda: comment_service.update_comment(session, current_user, comment_id, body)
    )
    session.refresh(comment)
    return comment_service.to_response(comment, current_user)


@router.delete(
    "/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(401, 403, 404),
)
def delete_comment(
    comment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """感想の投稿者、またはレシピの投稿者が感想を削除する。"""
    run_with_retry(
        session, lambda: comment_service.delete_comment(session, current_user, comment_id)
    )
    return None
