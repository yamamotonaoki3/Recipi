"""`/api/v1/recipes/*` ＋ `/api/v1/users/me/recipes` エンドポイント（Issue #37）。

トランザクション境界（processing-model.md §6）: 1 リクエスト = 1 トランザクション。
書き込み系（POST / PUT / DELETE）は、レスポンスを組み立てる前に必ず
`session.commit()` を明示的に呼ぶ（理由は app/api/auth.py 冒頭のコメント）。

認可（features/recipe.md §3）:
- 作成: ログインユーザーが投稿者になる
- 詳細: 公開は誰でも / 非公開は本人のみ / 他人は **404**（存在を伏せる）
- 更新・削除: 投稿者本人のみ（他人は 403）
- 自分の一覧: 本人の公開 / 非公開すべて
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db import get_session
from app.dependencies import get_current_user, get_current_user_optional
from app.errors import ErrorEnvelope, forbidden, not_found, validation_error
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.recipe import (
    RecipeFeedResponse,
    RecipeListResponse,
    RecipeResponse,
    RecipeWriteRequest,
)
from app.services import history as history_service
from app.services import recipe as recipe_service

router = APIRouter(prefix="/api/v1", tags=["recipes"])


def _error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """openapi.json 用: 各エンドポイントが実際に返しうるエラーステータスを明示する。"""
    return {code: {"model": ErrorEnvelope} for code in status_codes}


# ホームのサブタブに対応する `feed` の値（features/home-feed.md §5）。
# `favorites` はお気に入り機能の Issue で `_SUPPORTED_FEEDS` に移す。
_SUPPORTED_FEEDS = frozenset({"all", "following", "followers"})
_PLANNED_FEEDS = frozenset({"favorites"})


def _load_for_write(session: Session, user: User, recipe_id: uuid.UUID) -> Recipe:
    """更新 / 削除の対象レシピを取得する。存在しなければ 404、他人のものなら 403。"""
    recipe = session.get(Recipe, recipe_id)
    if recipe is None:
        raise not_found("レシピが見つかりません")
    if recipe.user_id != user.id:
        raise forbidden("他のユーザーのレシピは変更できません")
    return recipe


@router.post(
    "/recipes",
    status_code=status.HTTP_201_CREATED,
    responses=_error_responses(400, 401),
)
def create_recipe(
    body: RecipeWriteRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RecipeResponse:
    recipe = recipe_service.create_recipe(session, current_user, body)
    session.commit()
    session.refresh(recipe)
    return recipe_service.serialize_recipe(session, recipe, current_user, include_image_keys=True)


@router.get("/recipes", responses=_error_responses(400, 401))
def list_feed(
    feed: str = Query(default="all"),
    q: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RecipeFeedResponse:
    """ホームフィード / 検索（features/home-feed.md・search.md）。

    受け付ける `feed` は `all` / `following` / `followers`。`favorites` は
    お気に入り機能の Issue で有効化するので、今はまだ 400 にする
    （home-feed.md §6「不正値は 400」）。`q` はどの `feed` とも併用できる。
    """
    if feed not in _SUPPORTED_FEEDS:
        # 未対応の値と、そもそも定義に無い値を分けてメッセージにする。
        # 画面側は 4 タブを出すので、「まだ実装していない」ことが分かると調査が早い。
        if feed in _PLANNED_FEEDS:
            raise validation_error("feed=favorites はまだ利用できません", {"feed": feed})
        raise validation_error(
            "feed は all / following / followers のいずれかを指定してください", {"feed": feed}
        )
    return recipe_service.list_feed(
        session, current_user, feed=feed, q=q, cursor=cursor, limit=limit
    )


@router.get(
    "/recipes/{recipe_id}",
    responses=_error_responses(401, 404),
    # 認証は任意（公開レシピは匿名可）。HTTPBearer 依存があると FastAPI は
    # security を「必須」として文書化してしまうので、"認証なし"（{}）を
    # 選択肢に加えて上書きする（Codex #37 レビュー指摘）。
    openapi_extra={"security": [{}, {"HTTPBearer": []}]},
)
def get_recipe(
    recipe_id: uuid.UUID,
    current_user: User | None = Depends(get_current_user_optional),
    session: Session = Depends(get_session),
) -> RecipeResponse:
    recipe = session.get(Recipe, recipe_id)
    # 非公開レシピは、本人以外（匿名を含む）には「存在しない」ものとして 404 を返す
    # （403 だと ID の存在が漏れる。features/recipe.md §3）。
    if recipe is None or (
        not recipe.is_public and (current_user is None or recipe.user_id != current_user.id)
    ):
        raise not_found("レシピが見つかりません")
    author = session.get(User, recipe.user_id)
    assert author is not None  # FK があるので投稿者は必ず存在する
    # 画像キー（内部のストレージ識別子）は投稿者本人にだけ返す。
    is_owner = current_user is not None and current_user.id == recipe.user_id
    return recipe_service.serialize_recipe(session, recipe, author, include_image_keys=is_owner)


@router.put("/recipes/{recipe_id}", responses=_error_responses(400, 401, 403, 404))
def update_recipe(
    recipe_id: uuid.UUID,
    body: RecipeWriteRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RecipeResponse:
    recipe = _load_for_write(session, current_user, recipe_id)
    # `thumbnailKey` がリクエストに含まれていたか（省略 = 変更なし）。
    update_thumbnail = "thumbnail_key" in body.model_fields_set
    recipe = recipe_service.replace_recipe(
        session, current_user, recipe, body, update_thumbnail=update_thumbnail
    )
    session.commit()
    session.refresh(recipe)
    return recipe_service.serialize_recipe(session, recipe, current_user, include_image_keys=True)


@router.delete(
    "/recipes/{recipe_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(401, 403, 404),
)
def delete_recipe(
    recipe_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    recipe = _load_for_write(session, current_user, recipe_id)
    recipe_service.delete_recipe(session, recipe)
    session.commit()
    return None


@router.post(
    "/recipes/{recipe_id}/view",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(401, 404),
)
def record_recipe_view(
    recipe_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """レシピ詳細を開いた記録を残す（features/view-history.md §3）。

    クライアントは `GET /recipes/{id}` 成功後に非同期で 1 回だけ呼ぶ。
    見えないレシピは 404、成功は 204（body なし）。書き込みなので commit を明示する。
    """
    history_service.record_view(session, current_user, recipe_id)
    session.commit()
    return None


@router.get("/users/me/recipes", responses=_error_responses(400, 401))
def list_my_recipes(
    q: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RecipeListResponse:
    return recipe_service.list_my_recipes(session, current_user, q=q, cursor=cursor, limit=limit)


# **このルートは必ず上の `/users/me/recipes` より後ろに置く。**
# FastAPI はルートを登録した順に照合する。`/users/{user_id}/recipes` が先にあると、
# `/users/me/recipes` へのリクエストが先にこちらに当たり、"me" を UUID として
# 解釈しようとして 422 になる（＝今動いている自分のレシピ一覧が壊れる）。
# また `users.py` 側に置くのも同じ理由で不可（`main.py` は users のルーターを
# recipes のルーターより先に登録している）。
@router.get("/users/{user_id}/recipes", responses=_error_responses(400, 401, 404))
def list_user_recipes(
    user_id: uuid.UUID,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RecipeListResponse:
    """あるユーザーのレシピ一覧（features/profile.md §5）。

    他人が見れば公開レシピだけ、本人が見れば非公開も含む。存在しないユーザーは 404。
    """
    return recipe_service.list_recipes_by_owner(
        session, current_user, user_id, q=None, cursor=cursor, limit=limit
    )
