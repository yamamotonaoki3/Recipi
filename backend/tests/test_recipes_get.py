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


def test_missing_recipe_returns_404(client: TestClient) -> None:
    assert client.get(f"{RECIPES_URL}/00000000-0000-0000-0000-000000000000").status_code == 404


def test_invalid_token_returns_401(client: TestClient) -> None:
    owner = auth_headers(client)
    recipe_id = _create(client, owner, is_public=True)
    res = client.get(f"{RECIPES_URL}/{recipe_id}", headers={"Authorization": "Bearer not-a-token"})
    assert res.status_code == 401
