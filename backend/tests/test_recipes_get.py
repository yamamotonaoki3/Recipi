"""GET /api/v1/recipes/{id} の可視性の結合テスト（features/recipe.md §3）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"


def _create(client: TestClient, headers: dict[str, str], *, is_public: bool) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(isPublic=is_public), headers=headers)
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def test_public_recipe_is_visible_to_anonymous(client: TestClient) -> None:
    owner = auth_headers(client)
    recipe_id = _create(client, owner, is_public=True)
    res = client.get(f"{RECIPES_URL}/{recipe_id}")
    assert res.status_code == 200
    assert res.json()["author"]["displayName"] == "テスト太郎"


def test_private_recipe_visible_to_owner(client: TestClient) -> None:
    owner = auth_headers(client)
    recipe_id = _create(client, owner, is_public=False)
    assert client.get(f"{RECIPES_URL}/{recipe_id}", headers=owner).status_code == 200


def test_private_recipe_hidden_from_other_user_as_404(client: TestClient) -> None:
    owner = auth_headers(client)
    other = auth_headers(client)
    recipe_id = _create(client, owner, is_public=False)
    assert client.get(f"{RECIPES_URL}/{recipe_id}", headers=other).status_code == 404


def test_private_recipe_hidden_from_anonymous_as_404(client: TestClient) -> None:
    owner = auth_headers(client)
    recipe_id = _create(client, owner, is_public=False)
    assert client.get(f"{RECIPES_URL}/{recipe_id}").status_code == 404


def test_image_keys_only_returned_to_owner(client: TestClient) -> None:
    """サムネ / 手順画像のオブジェクトキーは投稿者本人にだけ返す（内部識別子）。"""
    owner = auth_headers(client)
    other = auth_headers(client)
    res = client.post(
        RECIPES_URL,
        json=recipe_payload(isPublic=True, thumbnailKey="uploads/thumb-1"),
        headers=owner,
    )
    assert res.status_code == 201
    recipe_id = res.json()["id"]

    as_owner = client.get(f"{RECIPES_URL}/{recipe_id}", headers=owner).json()
    assert as_owner["thumbnailKey"] == "uploads/thumb-1"

    as_other = client.get(f"{RECIPES_URL}/{recipe_id}", headers=other).json()
    assert as_other["thumbnailKey"] is None
    assert as_other["thumbnailUrl"] is not None  # 表示用 URL は誰でも見える

    anon = client.get(f"{RECIPES_URL}/{recipe_id}").json()
    assert anon["thumbnailKey"] is None


def test_missing_recipe_returns_404(client: TestClient) -> None:
    assert client.get(f"{RECIPES_URL}/00000000-0000-0000-0000-000000000000").status_code == 404


def test_invalid_token_returns_401(client: TestClient) -> None:
    owner = auth_headers(client)
    recipe_id = _create(client, owner, is_public=True)
    res = client.get(f"{RECIPES_URL}/{recipe_id}", headers={"Authorization": "Bearer not-a-token"})
    assert res.status_code == 401
