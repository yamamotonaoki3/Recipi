"""`/api/v1/users/*` エンドポイント（Phase 1 では自分の表示名変更のみ）。

書き込みを終えたら `return` する前に必ず `session.commit()` する理由は
`app/api/auth.py` 冒頭のコメントを参照（FastAPI の `Depends(yield)` は
レスポンス送信後に後始末コードを実行するため、自動コミットに任せると
「クライアントが成功レスポンスを受け取った直後の別リクエストがまだ古い
状態を見てしまう」競合が起きうる）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db import get_session, run_with_retry
from app.dependencies import get_current_user
from app.errors import ErrorEnvelope
from app.models.user import User
from app.schemas.follow import UserProfileResponse, UserRowListResponse
from app.schemas.recipe import HistoryResponse
from app.schemas.user import UpdateMeRequest, UserMeResponse
from app.services import follow as follow_service
from app.services import history as history_service

router = APIRouter(prefix="/api/v1/users", tags=["users"])


def _error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """openapi.json 用: 各エンドポイントが実際に返しうるエラーステータスを明示する。"""
    return {code: {"model": ErrorEnvelope} for code in status_codes}


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


# --- フォロー / フォロワー（Issue #66・features/follow.md §5） ----------
#
# ルートの宣言順が重要: FastAPI は上から順にマッチさせるので、リテラルの
# `/me/...` を先に書かないと `/{user_id}/...` が "me" を UUID として解釈しようとして
# 422 になる。以下は必ず `/me/*` → `/{user_id}/*` の順に並べる。


@router.get("/me/following", responses=_error_responses(400, 401))
def list_my_following(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRowListResponse:
    """自分がフォローしているユーザー一覧。

    `GET /users/{id}/following` に自分の ID を渡した場合と同じ内容を返す
    ショートカット（follow.md §5）。クライアントが自分の ID を持っていなくても
    呼べるようにするためのもの。
    """
    return follow_service.list_following(
        session, current_user, current_user.id, cursor=cursor, limit=limit
    )


@router.get("/me/followers", responses=_error_responses(400, 401))
def list_my_followers(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRowListResponse:
    """自分をフォローしているユーザー一覧。

    各要素の `isFollowing` は「自分がその人をフォローしているか」なので、
    画面ではフォローバック済みかどうかの判定に使える（follow.md §5）。
    """
    return follow_service.list_followers(
        session, current_user, current_user.id, cursor=cursor, limit=limit
    )


@router.get("/{user_id}", responses=_error_responses(401, 404))
def get_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserProfileResponse:
    """ユーザープロフィール（features/profile.md §5 の最小版）。

    アバター・メール・SNS リンク・公開トグルはプロフィール拡張の Issue で足す。
    """
    return follow_service.get_user_profile(session, current_user, user_id)


@router.post(
    "/{user_id}/follow",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(400, 401, 404),
)
def follow_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """`user_id` をフォローする。冪等（二重フォローでも 204）。

    `run_with_retry` で包む理由: 同じ相手に同時フォローが来ると `users` 行の
    ロック待ちが発生し、まれにデッドロックで中断されることがある。
    そのときはサーバー側でやり直し、クライアントにはエラーを見せない
    （follow.md §3 / non-functional.md）。commit も `run_with_retry` が行う。
    """
    run_with_retry(session, lambda: follow_service.follow(session, current_user, user_id))
    return None


@router.delete(
    "/{user_id}/follow",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(401),
)
def unfollow_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """フォローを解除する。フォローしていなくても 204（冪等）。"""
    run_with_retry(session, lambda: follow_service.unfollow(session, current_user, user_id))
    return None


@router.get("/{user_id}/following", responses=_error_responses(400, 401, 404))
def list_user_following(
    user_id: uuid.UUID,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRowListResponse:
    """`user_id` のユーザーがフォローしているユーザー一覧。"""
    return follow_service.list_following(session, current_user, user_id, cursor=cursor, limit=limit)


@router.get("/{user_id}/followers", responses=_error_responses(400, 401, 404))
def list_user_followers(
    user_id: uuid.UUID,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRowListResponse:
    """`user_id` のユーザーをフォローしているユーザー一覧。"""
    return follow_service.list_followers(session, current_user, user_id, cursor=cursor, limit=limit)
