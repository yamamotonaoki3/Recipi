"""ユーザーのレシピ一覧 `GET /users/{id}/recipes` の結合テスト（Issue #67）。

features/profile.md §5: 他人が見れば公開レシピだけ、本人が見れば非公開も含む。

BB: 公開 / 非公開の見え方、ページング、`limit` の境界、存在しないユーザー、未認証。
WB: **他のユーザーのレシピが 1 件も混ざらない**こと（所有者の条件が抜けた実装を
捕まえる負例）。共有テスト DB でも、新しく作ったユーザーの一覧は自分が作った
レシピだけになるので、ID の集合を厳密に比べられる。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.helpers import recipe_payload, signup

pytestmark = pytest.mark.integration

USERS_URL = "/api/v1/users"
RECIPES_URL = "/api/v1/recipes"


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = str(body["user"]["id"])


def _create(client: TestClient, owner: _User, *, public: bool, title: str) -> str:
    res = client.post(
        RECIPES_URL, json=recipe_payload(title=title, isPublic=public), headers=owner.headers
    )
    assert res.status_code == 201, res.text
    recipe_id: str = res.json()["id"]
    return recipe_id


def _all_items(
    client: TestClient, viewer: _User, owner_id: str, *, limit: int = 50
) -> list[dict[str, Any]]:
    """一覧を最後までページングして全件返す。"""
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(50):
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        res = client.get(f"{USERS_URL}/{owner_id}/recipes", params=params, headers=viewer.headers)
        assert res.status_code == 200, res.text
        page = res.json()
        items.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            break
    return items


@pytest.fixture
def world(client: TestClient) -> dict[str, Any]:
    """A に公開 2 件・非公開 1 件、B に公開 1 件。C は無関係の閲覧者。"""
    a, b, c = _User(client), _User(client), _User(client)
    return {
        "a": a,
        "b": b,
        "c": c,
        "a_public": {
            _create(client, a, public=True, title="Aの公開レシピ1"),
            _create(client, a, public=True, title="Aの公開レシピ2"),
        },
        "a_private": {_create(client, a, public=False, title="Aの非公開レシピ")},
        "b_public": {_create(client, b, public=True, title="Bの公開レシピ")},
    }


def test_other_viewer_sees_only_the_owners_public_recipes(
    client: TestClient, world: dict[str, Any]
) -> None:
    """他人が A の一覧を見ると、A の公開レシピだけ（非公開も、B のレシピも出ない）。"""
    ids = {item["id"] for item in _all_items(client, world["c"], world["a"].id)}

    assert ids == world["a_public"]
    assert not (ids & world["b_public"])
    assert not (ids & world["a_private"])


def test_owner_sees_own_private_recipes_too(client: TestClient, world: dict[str, Any]) -> None:
    """本人が自分の一覧を見ると、非公開も含めて自分のレシピだけ。"""
    items = _all_items(client, world["a"], world["a"].id)
    ids = {item["id"] for item in items}

    assert ids == world["a_public"] | world["a_private"]
    assert not (ids & world["b_public"])
    public_flags = {item["id"]: item["isPublic"] for item in items}
    assert all(public_flags[i] for i in world["a_public"])
    assert not any(public_flags[i] for i in world["a_private"])


def test_items_have_card_fields(client: TestClient, world: dict[str, Any]) -> None:
    """レシピカードに要る投稿者・お気に入り数が付いている（screens/components.md）。"""
    items = _all_items(client, world["c"], world["a"].id)

    for item in items:
        assert item["author"]["id"] == world["a"].id
        assert item["author"]["avatarUrl"] is None  # アバター未設定
        assert item["favoriteCount"] == 0
        assert {"id", "title", "thumbnailUrl", "isPublic", "createdAt"} <= set(item)


def test_pagination_walks_all_rows(client: TestClient, world: dict[str, Any]) -> None:
    """1 件ずつページングしても、抜けも重複もなく全件たどれる。"""
    items = _all_items(client, world["a"], world["a"].id, limit=1)
    ids = [item["id"] for item in items]

    assert len(ids) == len(set(ids)) == 3
    assert set(ids) == world["a_public"] | world["a_private"]


@pytest.mark.parametrize(("limit", "expected"), [("0", 400), ("1", 200), ("50", 200), ("51", 400)])
def test_limit_boundaries(client: TestClient, limit: str, expected: int) -> None:
    viewer = _User(client)
    res = client.get(
        f"{USERS_URL}/{viewer.id}/recipes", params={"limit": limit}, headers=viewer.headers
    )
    assert res.status_code == expected, res.text


def test_malformed_cursor_returns_400(client: TestClient) -> None:
    viewer = _User(client)
    res = client.get(
        f"{USERS_URL}/{viewer.id}/recipes",
        params={"cursor": "not-base64!!"},
        headers=viewer.headers,
    )
    assert res.status_code == 400, res.text


def test_unknown_user_returns_404(client: TestClient) -> None:
    viewer = _User(client)
    res = client.get(f"{USERS_URL}/{uuid.uuid4()}/recipes", headers=viewer.headers)
    assert res.status_code == 404, res.text


def test_requires_auth(client: TestClient) -> None:
    viewer = _User(client)
    res = client.get(f"{USERS_URL}/{viewer.id}/recipes")
    assert res.status_code == 401, res.text


def test_me_recipes_route_is_not_shadowed(client: TestClient) -> None:
    """`/users/me/recipes` が `/users/{user_id}/recipes` に横取りされず 200 のまま。

    後者を先に登録すると "me" を UUID として解釈して 422 になる（ルート登録順）。
    """
    me = _User(client)
    res = client.get(f"{USERS_URL}/me/recipes", headers=me.headers)
    assert res.status_code == 200, res.text
