"""GET /api/v1/users/me/recipes（一覧・q 検索・ページング）の結合テスト。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"
MY_RECIPES_URL = "/api/v1/users/me/recipes"


def _create(client: TestClient, headers: dict[str, str], **overrides) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(**overrides), headers=headers)
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def test_lists_own_public_and_private(client: TestClient) -> None:
    headers = auth_headers(client)
    _create(client, headers, title="公開レシピ", isPublic=True)
    _create(client, headers, title="非公開レシピ", isPublic=False)

    res = client.get(MY_RECIPES_URL, headers=headers)
    assert res.status_code == 200
    items = res.json()["items"]
    titles = {i["title"] for i in items}
    assert {"公開レシピ", "非公開レシピ"} <= titles
    private = next(i for i in items if i["title"] == "非公開レシピ")
    assert private["isPublic"] is False


def test_requires_auth(client: TestClient) -> None:
    assert client.get(MY_RECIPES_URL).status_code == 401


def test_pagination_walks_all_rows(client: TestClient) -> None:
    headers = auth_headers(client)
    for i in range(5):
        _create(client, headers, title=f"レシピ{i}")

    seen: set[str] = set()
    cursor: str | None = None
    for _ in range(10):  # 無限ループ保険
        params: dict[str, object] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = client.get(MY_RECIPES_URL, params=params, headers=headers).json()
        seen.update(i["id"] for i in page["items"])
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert len(seen) == 5


def test_q_single_term_matches_title_or_ingredient(client: TestClient) -> None:
    headers = auth_headers(client)
    _create(client, headers, title="玉ねぎスープ")
    _create(
        client,
        headers,
        title="炒め物",
        ingredientGroups=[
            {"name": None, "ingredients": [{"name": "玉ねぎ", "quantity": 1, "unit": "個"}]}
        ],
    )
    _create(client, headers, title="味噌汁")

    items = client.get(MY_RECIPES_URL, params={"q": "玉ねぎ"}, headers=headers).json()["items"]
    titles = {i["title"] for i in items}
    assert titles == {"玉ねぎスープ", "炒め物"}


def test_q_multiple_terms_are_anded(client: TestClient) -> None:
    headers = auth_headers(client)
    _create(client, headers, title="玉ねぎと豚肉の炒め物")
    _create(client, headers, title="玉ねぎサラダ")

    for q in ("玉ねぎ 豚肉", "玉ねぎ　豚肉"):  # 半角 / 全角スペース
        items = client.get(MY_RECIPES_URL, params={"q": q}, headers=headers).json()["items"]
        assert [i["title"] for i in items] == ["玉ねぎと豚肉の炒め物"]


def test_q_without_space_is_single_term(client: TestClient) -> None:
    headers = auth_headers(client)
    _create(client, headers, title="玉ねぎと豚肉の炒め物")
    items = client.get(MY_RECIPES_URL, params={"q": "玉ねぎ豚肉"}, headers=headers).json()["items"]
    assert items == []


def test_q_case_and_width_insensitive(client: TestClient) -> None:
    headers = auth_headers(client)
    _create(client, headers, title="ABC Pancake")
    items = client.get(MY_RECIPES_URL, params={"q": "ｐａｎｃａｋｅ"}, headers=headers).json()[
        "items"
    ]
    assert [i["title"] for i in items] == ["ABC Pancake"]


def test_q_wildcard_chars_are_literal(client: TestClient) -> None:
    """`q` の % / _ は SQL ワイルドカードではなくリテラルとして扱う。"""
    headers = auth_headers(client)
    _create(client, headers, title="100%オレンジ")
    _create(client, headers, title="ただのジュース")

    items = client.get(MY_RECIPES_URL, params={"q": "%"}, headers=headers).json()["items"]
    # "%" を含むレシピだけがヒットする（全件ではない）。
    assert [i["title"] for i in items] == ["100%オレンジ"]


@pytest.mark.parametrize("cursor", ["not-base64!!", "日本語カーソル"])
def test_malformed_cursor_returns_400(client: TestClient, cursor: str) -> None:
    headers = auth_headers(client)
    res = client.get(MY_RECIPES_URL, params={"cursor": cursor}, headers=headers)
    assert res.status_code == 400


def test_q_too_many_terms_returns_400(client: TestClient) -> None:
    headers = auth_headers(client)
    res = client.get(MY_RECIPES_URL, params={"q": "a b c d e f"}, headers=headers)
    assert res.status_code == 400
