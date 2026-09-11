"""お気に入り（♡）の結合テスト（Issue #68 / features/favorite.md）。

BB（仕様ベース）: 登録 / 解除、冪等、可視性の同値分割（公開 / 自分の非公開 /
他人の非公開 / 存在しない）、非公開化・削除で一覧から消える、2 つの一覧 API が
同じ内容を登録日時順で返す、ページング、`isFavorited` が閲覧者から見た状態。
WB（実装ベース）: 「実際に増減した」分岐と「何もしなかった」分岐（RETURNING）、
通知を作る / 作らない分岐、`feed=favorites` と `q` の併用、同時登録でのカウント。
"""

from __future__ import annotations

import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import engine
from app.models.favorite import Favorite
from app.models.notification import Notification
from app.models.recipe import Recipe
from tests.helpers import recipe_payload, signup

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"
MY_FAVORITES_URL = "/api/v1/users/me/favorites"


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = str(body["user"]["id"])
        self.uuid = uuid.UUID(self.id)


def _create(
    client: TestClient, owner: _User, *, public: bool = True, title: str = "肉じゃが"
) -> str:
    res = client.post(
        RECIPES_URL, json=recipe_payload(title=title, isPublic=public), headers=owner.headers
    )
    assert res.status_code == 201, res.text
    recipe_id: str = res.json()["id"]
    return recipe_id


def _fav(client: TestClient, user: _User, recipe_id: str) -> int:
    status: int = client.post(
        f"{RECIPES_URL}/{recipe_id}/favorite", headers=user.headers
    ).status_code
    return status


def _unfav(client: TestClient, user: _User, recipe_id: str) -> int:
    status: int = client.delete(
        f"{RECIPES_URL}/{recipe_id}/favorite", headers=user.headers
    ).status_code
    return status


def _detail(client: TestClient, viewer: _User, recipe_id: str) -> dict[str, Any]:
    res = client.get(f"{RECIPES_URL}/{recipe_id}", headers=viewer.headers)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def _db_count(recipe_id: str) -> int:
    """DB 上の `favorite_count`（詳細が 404 になる場面でも数えられるように）。"""
    with Session(engine) as s:
        recipe = s.get(Recipe, uuid.UUID(recipe_id))
        assert recipe is not None
        return recipe.favorite_count


def _db_rows(user: _User, recipe_id: str) -> int:
    with Session(engine) as s:
        rows = s.exec(
            select(Favorite).where(
                Favorite.user_id == user.uuid, Favorite.recipe_id == uuid.UUID(recipe_id)
            )
        ).all()
        return len(rows)


def _list(
    client: TestClient,
    viewer: _User,
    *,
    via: str = "me",
    q: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """お気に入り一覧を最後までページングして全件返す（`me` = /users/me/favorites）。"""
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(50):
        params: dict[str, Any] = {"limit": limit}
        if via == "feed":
            params["feed"] = "favorites"
        if q is not None:
            params["q"] = q
        if cursor:
            params["cursor"] = cursor
        url = MY_FAVORITES_URL if via == "me" else RECIPES_URL
        res = client.get(url, params=params, headers=viewer.headers)
        assert res.status_code == 200, res.text
        page = res.json()
        items.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            break
    return items


def _ids(items: list[dict[str, Any]]) -> list[str]:
    return [item["id"] for item in items]


# --- 登録 / 解除 ---------------------------------------------------------


def test_favorite_and_unfavorite_update_count_and_flag(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)

    assert _fav(client, me, rid) == 204
    after = _detail(client, me, rid)
    assert after["favoriteCount"] == 1
    assert after["isFavorited"] is True

    assert _unfav(client, me, rid) == 204
    back = _detail(client, me, rid)
    assert back["favoriteCount"] == 0
    assert back["isFavorited"] is False


def test_double_favorite_is_idempotent(client: TestClient) -> None:
    """二重登録しても行は 1 件・カウント 1 のまま（WB: RETURNING が返らない分岐）。"""
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)

    assert [_fav(client, me, rid) for _ in range(3)] == [204, 204, 204]

    assert _db_rows(me, rid) == 1
    assert _db_count(rid) == 1


def test_unfavorite_when_not_favorited_is_204(client: TestClient) -> None:
    """未登録の解除・存在しないレシピの解除も 204 で、カウントは動かない。"""
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)

    assert _unfav(client, me, rid) == 204
    assert _unfav(client, me, str(uuid.uuid4())) == 204
    assert _db_count(rid) == 0


# --- 可視性（同値分割） ---------------------------------------------------


def test_can_favorite_public_recipe_of_others(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _create(client, owner, public=True)
    assert _fav(client, me, rid) == 204


def test_can_favorite_own_private_recipe_and_it_is_listed(client: TestClient) -> None:
    """自分の非公開レシピはお気に入りでき、一覧にも出る（todo #11 で確定）。"""
    me = _User(client)
    rid = _create(client, me, public=False, title="自分の非公開")

    assert _fav(client, me, rid) == 204
    assert _ids(_list(client, me)) == [rid]


def test_cannot_favorite_private_recipe_of_others(client: TestClient) -> None:
    """他人の非公開レシピは 404（存在しないレシピと区別しない）。行も作らない。"""
    owner, me = _User(client), _User(client)
    rid = _create(client, owner, public=False)

    assert _fav(client, me, rid) == 404
    assert _db_rows(me, rid) == 0
    assert _db_count(rid) == 0


def test_cannot_favorite_unknown_recipe(client: TestClient) -> None:
    me = _User(client)
    assert _fav(client, me, str(uuid.uuid4())) == 404


def test_requires_auth(client: TestClient) -> None:
    owner = _User(client)
    rid = _create(client, owner)
    assert client.post(f"{RECIPES_URL}/{rid}/favorite").status_code == 401
    assert client.delete(f"{RECIPES_URL}/{rid}/favorite").status_code == 401
    assert client.get(MY_FAVORITES_URL).status_code == 401


# --- 非公開化・削除 ---------------------------------------------------------


def test_hidden_when_owner_makes_it_private_but_row_remains(client: TestClient) -> None:
    """他人のレシピが非公開化されたら一覧に出ない。行は残るので、公開に戻れば再び出る。"""
    owner, me = _User(client), _User(client)
    rid = _create(client, owner, title="あとで非公開")
    assert _fav(client, me, rid) == 204

    res = client.put(
        f"{RECIPES_URL}/{rid}",
        json=recipe_payload(title="あとで非公開", isPublic=False),
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text

    assert _ids(_list(client, me)) == []
    assert _ids(_list(client, me, via="feed")) == []
    assert _db_rows(me, rid) == 1  # 行は残っている

    res = client.put(
        f"{RECIPES_URL}/{rid}",
        json=recipe_payload(title="あとで非公開", isPublic=True),
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text
    assert _ids(_list(client, me)) == [rid]


def test_can_unfavorite_after_owner_made_it_private(client: TestClient) -> None:
    """公開中にお気に入りした他人のレシピが非公開になっても、自分で外せる（204・−1）。

    登録時の可視性チェックを解除にも使ってしまうと、ここが 404 になって外せなくなる。
    """
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)
    assert _fav(client, me, rid) == 204
    client.put(f"{RECIPES_URL}/{rid}", json=recipe_payload(isPublic=False), headers=owner.headers)

    assert _unfav(client, me, rid) == 204
    assert _db_rows(me, rid) == 0
    assert _db_count(rid) == 0


def test_deleted_recipe_disappears_with_its_rows(client: TestClient) -> None:
    """レシピが削除されたら一覧に出ない（ON DELETE CASCADE で行ごと消える）。"""
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)
    assert _fav(client, me, rid) == 204

    assert client.delete(f"{RECIPES_URL}/{rid}", headers=owner.headers).status_code == 204

    assert _ids(_list(client, me)) == []
    assert _db_rows(me, rid) == 0


# --- 一覧 -------------------------------------------------------------------


def test_both_list_apis_return_the_same_newest_first(client: TestClient) -> None:
    """`GET /users/me/favorites` と `feed=favorites` が同じ内容を、登録日時の新しい順で返す。"""
    owner, me = _User(client), _User(client)
    r1 = _create(client, owner, title="お気に入り1")
    r2 = _create(client, owner, title="お気に入り2")
    r3 = _create(client, owner, title="お気に入り3")
    # 登録する順番とレシピを作った順番をわざとずらす（並びが「登録日時」だと確かめるため）。
    for rid in (r2, r3, r1):
        assert _fav(client, me, rid) == 204

    via_me = _list(client, me)
    via_feed = _list(client, me, via="feed")

    assert _ids(via_me) == [r1, r3, r2]
    assert via_me == via_feed
    assert all(item["isFavorited"] is True for item in via_me)
    assert {"id", "title", "thumbnailUrl", "author", "favoriteCount", "isFavorited"} == set(
        via_me[0]
    )


def test_pagination_walks_all_rows(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rids = [_create(client, owner, title=f"ページ{i}") for i in range(3)]
    for rid in rids:
        _fav(client, me, rid)

    for via in ("me", "feed"):
        ids = _ids(_list(client, me, via=via, limit=1))
        assert len(ids) == len(set(ids)) == 3
        assert set(ids) == set(rids)


@pytest.mark.parametrize(("limit", "expected"), [("0", 400), ("1", 200), ("50", 200), ("51", 400)])
def test_limit_boundaries(client: TestClient, limit: str, expected: int) -> None:
    me = _User(client)
    res = client.get(MY_FAVORITES_URL, params={"limit": limit}, headers=me.headers)
    assert res.status_code == expected, res.text


@pytest.mark.parametrize("via", ["me", "feed"])
def test_malformed_cursor_returns_400(client: TestClient, via: str) -> None:
    me = _User(client)
    params: dict[str, Any] = {"cursor": "not-base64!!"}
    if via == "feed":
        params["feed"] = "favorites"
    url = MY_FAVORITES_URL if via == "me" else RECIPES_URL
    assert client.get(url, params=params, headers=me.headers).status_code == 400


def test_feed_favorites_can_be_narrowed_by_q(client: TestClient) -> None:
    """`feed=favorites` と `q` を併用すると、お気に入りの中を絞り込める（home-feed.md §3）。"""
    owner, me = _User(client), _User(client)
    tag = uuid.uuid4().hex[:6]
    hit = _create(client, owner, title=f"カレー{tag}")
    miss = _create(client, owner, title=f"シチュー{tag}")
    other = _create(client, owner, title=f"カレー{tag}（お気に入りしていない）")
    for rid in (hit, miss):
        _fav(client, me, rid)

    assert _ids(_list(client, me, via="feed", q=f"カレー{tag}")) == [hit]
    assert other not in _ids(_list(client, me, via="feed", q=f"カレー{tag}"))
    assert set(_ids(_list(client, me, via="feed"))) == {hit, miss}  # q 無しでは両方


# --- 通知 -------------------------------------------------------------------


def _notifications(owner: _User, recipe_id: str) -> list[Notification]:
    with Session(engine) as s:
        return list(
            s.exec(
                select(Notification).where(
                    Notification.user_id == owner.uuid,
                    Notification.recipe_id == uuid.UUID(recipe_id),
                    Notification.type == "recipe_favorited",
                )
            ).all()
        )


def test_favoriting_others_recipe_notifies_the_author_once(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)

    _fav(client, me, rid)
    _fav(client, me, rid)  # 二重登録では増えない

    rows = _notifications(owner, rid)
    assert len(rows) == 1
    assert rows[0].actor_id == me.uuid


def test_favoriting_own_recipe_creates_no_notification(client: TestClient) -> None:
    me = _User(client)
    rid = _create(client, me)

    assert _fav(client, me, rid) == 204

    assert _notifications(me, rid) == []


def test_unfavorite_keeps_the_notification(client: TestClient) -> None:
    """通知は起きた出来事の履歴なので、解除しても消さない（notification.md §3）。"""
    owner, me = _User(client), _User(client)
    rid = _create(client, owner)
    _fav(client, me, rid)

    assert _unfav(client, me, rid) == 204

    assert len(_notifications(owner, rid)) == 1


# --- isFavorited は閲覧者から見た状態 -----------------------------------------


def _find(items: list[dict[str, Any]], recipe_id: str) -> dict[str, Any]:
    for item in items:
        if item["id"] == recipe_id:
            return item
    raise AssertionError(f"{recipe_id} が見つからない")


def _feed_item(client: TestClient, viewer: _User, recipe_id: str) -> dict[str, Any]:
    cursor: str | None = None
    for _ in range(20):
        params: dict[str, Any] = {"feed": "all", "limit": 50}
        if cursor:
            params["cursor"] = cursor
        page = client.get(RECIPES_URL, params=params, headers=viewer.headers).json()
        for item in page["items"]:
            if item["id"] == recipe_id:
                found: dict[str, Any] = item
                return found
        cursor = page["nextCursor"]
        if not cursor:
            break
    raise AssertionError("フィードにレシピが見つからない")


def test_is_favorited_reflects_the_viewer_everywhere(client: TestClient) -> None:
    """詳細・フィード・お気に入り一覧・履歴・自分のレシピ一覧・ユーザーのレシピ一覧で、
    登録した人には true、別の人には false。
    """
    owner, fan, other = _User(client), _User(client), _User(client)
    rid = _create(client, owner)
    assert _fav(client, owner, rid) == 204  # 投稿者本人もお気に入り（自分のレシピ一覧の確認用）
    assert _fav(client, fan, rid) == 204
    for viewer in (fan, other):
        assert client.post(f"{RECIPES_URL}/{rid}/view", headers=viewer.headers).status_code == 204

    def get(path: str, viewer: _User) -> Any:
        res = client.get(path, headers=viewer.headers)
        assert res.status_code == 200, res.text
        return res.json()

    for viewer, expected in ((fan, True), (other, False)):
        assert _detail(client, viewer, rid)["isFavorited"] is expected
        assert _feed_item(client, viewer, rid)["isFavorited"] is expected
        history = get("/api/v1/users/me/history", viewer)["items"]
        assert _find(history, rid)["isFavorited"] is expected
        theirs = get(f"/api/v1/users/{owner.id}/recipes", viewer)["items"]
        assert _find(theirs, rid)["isFavorited"] is expected

    assert _find(_list(client, fan), rid)["isFavorited"] is True
    mine = get("/api/v1/users/me/recipes", owner)["items"]
    assert _find(mine, rid)["isFavorited"] is True
    assert _detail(client, fan, rid)["favoriteCount"] == 2

    # 未ログインで見ると常に false。
    anon = client.get(f"{RECIPES_URL}/{rid}")
    assert anon.status_code == 200, anon.text
    assert anon.json()["isFavorited"] is False


# --- 同時に登録されてもカウントが正しい -----------------------------------------


def test_concurrent_favorites_keep_the_count_correct(client: TestClient) -> None:
    """5 人が同じレシピを同時にお気に入りしても、エラーなしでちょうど 5（favorite.md §7）。

    `recipes` 行のロックで順番待ちになるので、クライアントにエラーは返らない。
    ロックを `FOR UPDATE` にしてしまうと、外部キーが自動で取る `FOR KEY SHARE` との
    昇格でデッドロックする（Issue #66 で実際に起きた）。
    """
    owner = _User(client)
    rid = _create(client, owner)
    fans = [_User(client) for _ in range(5)]
    statuses: list[int] = []
    guard = threading.Lock()

    def do_fav(user: _User) -> None:
        status = _fav(client, user, rid)
        with guard:
            statuses.append(status)

    threads = [threading.Thread(target=do_fav, args=(u,)) for u in fans]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert statuses == [204] * 5, statuses
    assert _db_count(rid) == 5
