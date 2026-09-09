"""閲覧履歴（POST /recipes/{id}/view, GET/DELETE /users/me/history）の結合テスト。

Issue #41 / features/view-history.md §7 の受け入れ基準。
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"
HISTORY_URL = "/api/v1/users/me/history"


def _create(client: TestClient, headers: dict[str, str], **overrides) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(**overrides), headers=headers)
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def _view(client: TestClient, headers: dict[str, str], recipe_id: str):
    return client.post(f"{RECIPES_URL}/{recipe_id}/view", headers=headers).status_code


def _history_ids(client: TestClient, headers: dict[str, str], **params) -> list[str]:
    res = client.get(HISTORY_URL, headers=headers, params=params)
    assert res.status_code == 200, res.text
    return [i["id"] for i in res.json()["items"]]


def test_view_then_history_lists_it_first(client: TestClient) -> None:
    owner = auth_headers(client, display_name="所有者")
    viewer = auth_headers(client, display_name="閲覧者")

    r1 = _create(client, owner, title="レシピA", isPublic=True)
    r2 = _create(client, owner, title="レシピB", isPublic=True)

    assert _view(client, viewer, r1) == 204
    assert _view(client, viewer, r2) == 204

    # 最後に見た r2 が先頭。
    ids = _history_ids(client, viewer)
    assert ids[:2] == [r2, r1]

    # 要素はカード形状 ＋ viewedAt。
    item = client.get(HISTORY_URL, headers=viewer).json()["items"][0]
    assert item["author"]["displayName"] == "所有者"
    assert "viewedAt" in item and item["favoriteCount"] == 0


def test_re_view_moves_to_front_without_duplicating(client: TestClient) -> None:
    owner = auth_headers(client)
    viewer = auth_headers(client)
    r1 = _create(client, owner, title="再閲覧1", isPublic=True)
    r2 = _create(client, owner, title="再閲覧2", isPublic=True)

    _view(client, viewer, r1)
    _view(client, viewer, r2)
    _view(client, viewer, r1)  # r1 を見直す → 先頭へ、行は増えない

    ids = _history_ids(client, viewer)
    assert ids[:2] == [r1, r2]
    assert ids.count(r1) == 1


def test_view_invisible_recipe_returns_404(client: TestClient) -> None:
    owner = auth_headers(client)
    viewer = auth_headers(client)
    private = _create(client, owner, title="他人の非公開", isPublic=False)

    assert _view(client, viewer, private) == 404
    assert _view(client, viewer, str(uuid.uuid4())) == 404
    # 履歴には何も載らない。
    assert _history_ids(client, viewer) == []


def test_view_own_private_recipe_is_recorded(client: TestClient) -> None:
    owner = auth_headers(client)
    mine_private = _create(client, owner, title="自分の非公開", isPublic=False)

    assert _view(client, owner, mine_private) == 204
    assert mine_private in _history_ids(client, owner)


def test_recipe_made_private_drops_out_of_history(client: TestClient) -> None:
    owner = auth_headers(client)
    viewer = auth_headers(client)
    rid = _create(client, owner, title="あとで非公開", isPublic=True)
    _view(client, viewer, rid)
    assert rid in _history_ids(client, viewer)

    # 投稿者が非公開化する。
    put = client.put(
        f"{RECIPES_URL}/{rid}",
        json=recipe_payload(title="あとで非公開", isPublic=False),
        headers=owner,
    )
    assert put.status_code == 200, put.text

    # 可視性フィルタで履歴一覧から外れる（行自体は残る）。
    assert rid not in _history_ids(client, viewer)

    # 公開に戻すと再び出る（行が消えていない証拠）。
    client.put(
        f"{RECIPES_URL}/{rid}",
        json=recipe_payload(title="あとで非公開", isPublic=True),
        headers=owner,
    )
    assert rid in _history_ids(client, viewer)


def test_deleted_recipe_drops_out_of_history(client: TestClient) -> None:
    owner = auth_headers(client)
    viewer = auth_headers(client)
    rid = _create(client, owner, title="消されるレシピ", isPublic=True)
    _view(client, viewer, rid)
    assert client.delete(f"{RECIPES_URL}/{rid}", headers=owner).status_code == 204
    assert rid not in _history_ids(client, viewer)


def test_clear_history(client: TestClient) -> None:
    owner = auth_headers(client)
    viewer = auth_headers(client)
    for i in range(3):
        rid = _create(client, owner, title=f"消去対象{i}", isPublic=True)
        _view(client, viewer, rid)
    assert len(_history_ids(client, viewer)) == 3

    assert client.delete(HISTORY_URL, headers=viewer).status_code == 204
    assert _history_ids(client, viewer) == []


def test_history_is_private_per_user(client: TestClient) -> None:
    owner = auth_headers(client)
    a = auth_headers(client)
    b = auth_headers(client)
    rid = _create(client, owner, title="Aだけが見る", isPublic=True)
    _view(client, a, rid)
    assert rid in _history_ids(client, a)
    assert _history_ids(client, b) == []


def test_history_pagination_walks_all_rows(client: TestClient) -> None:
    owner = auth_headers(client)
    viewer = auth_headers(client)
    created = [_create(client, owner, title=f"履歴ページング{i}", isPublic=True) for i in range(5)]
    for rid in created:
        _view(client, viewer, rid)

    seen: set[str] = set()
    cursor: str | None = None
    for _ in range(10):
        params: dict[str, object] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = client.get(HISTORY_URL, headers=viewer, params=params).json()
        page_ids = [i["id"] for i in page["items"]]
        assert not (set(page_ids) & seen)
        seen.update(page_ids)
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert set(created) == seen


@pytest.mark.parametrize(("limit", "expected"), [("0", 400), ("1", 200), ("50", 200), ("51", 400)])
def test_history_limit_boundaries(client: TestClient, limit: str, expected: int) -> None:
    viewer = auth_headers(client)
    assert client.get(HISTORY_URL, headers=viewer, params={"limit": limit}).status_code == expected


@pytest.mark.parametrize("cursor", ["not-base64!!", "日本語カーソル"])
def test_history_malformed_cursor_returns_400(client: TestClient, cursor: str) -> None:
    viewer = auth_headers(client)
    assert client.get(HISTORY_URL, headers=viewer, params={"cursor": cursor}).status_code == 400


def test_history_endpoints_require_auth(client: TestClient) -> None:
    assert client.get(HISTORY_URL).status_code == 401
    assert client.delete(HISTORY_URL).status_code == 401
    assert client.post(f"{RECIPES_URL}/{uuid.uuid4()}/view").status_code == 401
