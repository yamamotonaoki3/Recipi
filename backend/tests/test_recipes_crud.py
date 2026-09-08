"""POST / PUT / DELETE /api/v1/recipes の結合テスト（実 DB）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.models.recipe import Recipe
from app.models.step import Step
from tests.helpers import auth_headers, recipe_payload, upload_image

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"


# --- 作成の基本 ---------------------------------------------------------


def test_create_minimal_recipe_returns_flat_group(client: TestClient) -> None:
    headers = auth_headers(client)
    res = client.post(RECIPES_URL, json=recipe_payload(), headers=headers)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["title"] == "肉じゃが"
    # グループを作らず投稿 → 名前なしグループ 1 つ
    assert len(body["ingredientGroups"]) == 1
    assert body["ingredientGroups"][0]["name"] is None
    assert [s["body"] for s in body["steps"]] == ["材料を切る", "煮る"]
    # 画像キーは編集画面が PUT で維持するために必要（features/recipe.md §5）。
    # 画像未設定なので null だが、フィールド自体は返る。
    assert body["thumbnailKey"] is None
    assert all(s["imageKey"] is None for s in body["steps"])


def test_create_requires_auth(client: TestClient) -> None:
    res = client.post(RECIPES_URL, json=recipe_payload())
    assert res.status_code == 401


# --- 境界値（すべて 400 系は VALIDATION_ERROR） ------------------------


@pytest.mark.parametrize(
    ("title", "expected"),
    [("", 400), ("あ", 201), ("あ" * 120, 201), ("あ" * 121, 400)],
)
def test_title_length_boundary(client: TestClient, title: str, expected: int) -> None:
    headers = auth_headers(client)
    res = client.post(RECIPES_URL, json=recipe_payload(title=title), headers=headers)
    assert res.status_code == expected


@pytest.mark.parametrize(("servings", "expected"), [(0, 400), (1, 201), (99, 201), (100, 400)])
def test_servings_boundary(client: TestClient, servings: int, expected: int) -> None:
    headers = auth_headers(client)
    res = client.post(RECIPES_URL, json=recipe_payload(servings=servings), headers=headers)
    assert res.status_code == expected


@pytest.mark.parametrize("blank", ["   ", "　　"])
def test_whitespace_only_title_returns_400(client: TestClient, blank: str) -> None:
    headers = auth_headers(client)
    res = client.post(RECIPES_URL, json=recipe_payload(title=blank), headers=headers)
    assert res.status_code == 400


def test_whitespace_only_ingredient_name_returns_400(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = recipe_payload(ingredientGroups=[{"name": None, "ingredients": [{"name": "  "}]}])
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 400


def test_quantity_out_of_db_range_returns_400(client: TestClient) -> None:
    """NUMERIC(10,3) に収まらない数量は commit 前に 400 で弾く（500 にしない）。"""
    headers = auth_headers(client)
    payload = recipe_payload(
        ingredientGroups=[
            {"name": None, "ingredients": [{"name": "粉", "quantity": 99999999, "unit": "g"}]}
        ]
    )
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 400


def test_description_over_limit_returns_400(client: TestClient) -> None:
    headers = auth_headers(client)
    res = client.post(RECIPES_URL, json=recipe_payload(description="あ" * 2001), headers=headers)
    assert res.status_code == 400


def test_empty_group_ingredients_returns_400(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = recipe_payload(ingredientGroups=[{"name": "空グループ", "ingredients": []}])
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 400


def test_all_blank_steps_returns_400(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = recipe_payload(steps=[{"position": 1, "body": "   "}])
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 400


def test_blank_step_row_is_dropped(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = recipe_payload(
        steps=[
            {"position": 1, "body": "混ぜる"},
            {"position": 2, "body": "  "},
            {"position": 3, "body": "焼く"},
        ]
    )
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 201
    assert [s["body"] for s in res.json()["steps"]] == ["混ぜる", "焼く"]


@pytest.mark.parametrize(
    ("field", "builder"),
    [
        (
            "groups",
            lambda: recipe_payload(
                ingredientGroups=[
                    {"name": f"g{i}", "ingredients": [{"name": "x"}]} for i in range(21)
                ]
            ),
        ),
        (
            "ingredients",
            lambda: recipe_payload(
                ingredientGroups=[
                    {"name": None, "ingredients": [{"name": f"i{i}"} for i in range(51)]}
                ]
            ),
        ),
        (
            "steps",
            lambda: recipe_payload(
                steps=[{"position": i, "body": f"step {i}"} for i in range(101)]
            ),
        ),
    ],
)
def test_upper_limits_return_400(client: TestClient, field: str, builder) -> None:
    headers = auth_headers(client)
    res = client.post(RECIPES_URL, json=builder(), headers=headers)
    assert res.status_code == 400, field


# --- 単位の placement がレスポンスに乗る -----------------------------


def test_response_includes_unit_placement(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = recipe_payload(
        ingredientGroups=[
            {
                "name": None,
                "ingredients": [
                    {"name": "しょうゆ", "quantity": 2, "unit": "大さじ"},
                    {"name": "水", "quantity": 200, "unit": "g"},
                ],
            }
        ]
    )
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 201
    ings = res.json()["ingredientGroups"][0]["ingredients"]
    placement = {i["name"]: i["placement"] for i in ings}
    assert placement["しょうゆ"] == "prefix"
    assert placement["水"] == "suffix"


# --- 更新（PUT） ------------------------------------------------------


def _create(client: TestClient, headers: dict[str, str], **overrides) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(**overrides), headers=headers)
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def test_put_replaces_groups_and_steps(client: TestClient) -> None:
    headers = auth_headers(client)
    recipe_id = _create(client, headers)
    new_body = recipe_payload(
        title="肉じゃが改",
        ingredientGroups=[
            {"name": "主材料", "ingredients": [{"name": "里芋", "quantity": 4, "unit": "個"}]},
            {"name": "調味", "ingredients": [{"name": "みりん", "quantity": 1, "unit": "大さじ"}]},
        ],
        steps=[{"position": 1, "body": "皮をむく"}],
    )
    res = client.put(f"{RECIPES_URL}/{recipe_id}", json=new_body, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "肉じゃが改"
    assert [g["name"] for g in body["ingredientGroups"]] == ["主材料", "調味"]
    assert [s["body"] for s in body["steps"]] == ["皮をむく"]


def test_put_others_recipe_returns_403(client: TestClient) -> None:
    owner = auth_headers(client)
    other = auth_headers(client)
    recipe_id = _create(client, owner)
    res = client.put(f"{RECIPES_URL}/{recipe_id}", json=recipe_payload(), headers=other)
    assert res.status_code == 403


def test_put_missing_recipe_returns_404(client: TestClient) -> None:
    headers = auth_headers(client)
    res = client.put(
        f"{RECIPES_URL}/00000000-0000-0000-0000-000000000000",
        json=recipe_payload(),
        headers=headers,
    )
    assert res.status_code == 404


# --- サムネイルの省略 / null / 差し替え -----------------------------


def test_put_thumbnail_omitted_keeps_current(client: TestClient) -> None:
    headers = auth_headers(client)
    original = upload_image(client, headers)
    recipe_id = _create(client, headers, thumbnailKey=original)
    body = recipe_payload()  # thumbnailKey を含めない
    res = client.put(f"{RECIPES_URL}/{recipe_id}", json=body, headers=headers)
    assert res.status_code == 200
    assert res.json()["thumbnailUrl"] is not None
    assert res.json()["thumbnailUrl"].endswith(original)


def test_put_thumbnail_null_deletes(client: TestClient) -> None:
    headers = auth_headers(client)
    original = upload_image(client, headers)
    recipe_id = _create(client, headers, thumbnailKey=original)
    body = recipe_payload(thumbnailKey=None)
    res = client.put(f"{RECIPES_URL}/{recipe_id}", json=body, headers=headers)
    assert res.status_code == 200
    assert res.json()["thumbnailUrl"] is None


def test_put_thumbnail_new_key_replaces(client: TestClient) -> None:
    headers = auth_headers(client)
    original = upload_image(client, headers)
    replacement = upload_image(client, headers)
    recipe_id = _create(client, headers, thumbnailKey=original)
    body = recipe_payload(thumbnailKey=replacement)
    res = client.put(f"{RECIPES_URL}/{recipe_id}", json=body, headers=headers)
    assert res.status_code == 200
    assert res.json()["thumbnailUrl"].endswith(replacement)


@pytest.mark.parametrize("blank_key", ["", "   ", "　　"])
def test_create_blank_thumbnail_key_is_saved_as_null(
    client: TestClient, db_session, blank_key: str
) -> None:
    """画像キーの空入力は、DB に空文字ではなく NULL として保存する。"""
    headers = auth_headers(client)
    res = client.post(
        RECIPES_URL,
        json=recipe_payload(thumbnailKey=blank_key),
        headers=headers,
    )
    assert res.status_code == 201, res.text

    recipe = db_session.get(Recipe, res.json()["id"])
    assert recipe is not None
    assert recipe.thumbnail_key is None
    assert res.json()["thumbnailKey"] is None


@pytest.mark.parametrize("blank_key", ["", "   ", "　　"])
def test_create_blank_step_image_key_is_saved_as_null(
    client: TestClient, db_session, blank_key: str
) -> None:
    """手順画像キーの空入力も、DB に空文字ではなく NULL として保存する。"""
    headers = auth_headers(client)
    res = client.post(
        RECIPES_URL,
        json=recipe_payload(steps=[{"position": 1, "body": "材料を切る", "imageKey": blank_key}]),
        headers=headers,
    )
    assert res.status_code == 201, res.text

    recipe_id = res.json()["id"]
    step = db_session.exec(select(Step).where(Step.recipe_id == recipe_id)).one()
    assert step.image_key is None
    assert res.json()["steps"][0]["imageKey"] is None


@pytest.mark.parametrize("blank_key", ["", "   ", "　　"])
def test_put_blank_thumbnail_key_deletes_current_thumbnail(
    client: TestClient, db_session, blank_key: str
) -> None:
    """PUT の空画像キーは省略ではなく、明示的なサムネイル削除として扱う。"""
    headers = auth_headers(client)
    original = upload_image(client, headers)
    recipe_id = _create(client, headers, thumbnailKey=original)

    res = client.put(
        f"{RECIPES_URL}/{recipe_id}",
        json=recipe_payload(thumbnailKey=blank_key),
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["thumbnailKey"] is None
    assert res.json()["thumbnailUrl"] is None

    recipe = db_session.get(Recipe, recipe_id)
    assert recipe is not None
    assert recipe.thumbnail_key is None


# --- 削除（DELETE） -------------------------------------------------


def test_delete_own_recipe(client: TestClient) -> None:
    headers = auth_headers(client)
    recipe_id = _create(client, headers)
    assert client.delete(f"{RECIPES_URL}/{recipe_id}", headers=headers).status_code == 204
    assert client.get(f"{RECIPES_URL}/{recipe_id}", headers=headers).status_code == 404


def test_delete_others_recipe_returns_403(client: TestClient) -> None:
    owner = auth_headers(client)
    other = auth_headers(client)
    recipe_id = _create(client, owner)
    assert client.delete(f"{RECIPES_URL}/{recipe_id}", headers=other).status_code == 403


# --- 材料のレシピ参照（refRecipeId） ------------------------------


def test_ref_recipe_id_must_be_own(client: TestClient) -> None:
    owner = auth_headers(client)
    other = auth_headers(client)
    others_recipe = _create(client, other)
    payload = recipe_payload(
        ingredientGroups=[
            {
                "name": None,
                "ingredients": [{"name": "たれ", "refRecipeId": others_recipe}],
            }
        ]
    )
    res = client.post(RECIPES_URL, json=payload, headers=owner)
    assert res.status_code == 400


def test_ref_recipe_id_self_reference_returns_400(client: TestClient) -> None:
    headers = auth_headers(client)
    recipe_id = _create(client, headers)
    payload = recipe_payload(
        ingredientGroups=[
            {"name": None, "ingredients": [{"name": "自分", "refRecipeId": recipe_id}]}
        ]
    )
    res = client.put(f"{RECIPES_URL}/{recipe_id}", json=payload, headers=headers)
    assert res.status_code == 400


def test_ref_recipe_link_survives_target_deletion_as_snapshot(client: TestClient) -> None:
    headers = auth_headers(client)
    base = client.post(
        RECIPES_URL, json=recipe_payload(title="自家製だれ"), headers=headers
    ).json()["id"]
    parent_payload = recipe_payload(
        ingredientGroups=[{"name": None, "ingredients": [{"name": "だれ", "refRecipeId": base}]}]
    )
    parent_id = client.post(RECIPES_URL, json=parent_payload, headers=headers).json()["id"]

    # 参照先を削除 → 参照元は残り、refRecipe.id は null・title はスナップショット。
    assert client.delete(f"{RECIPES_URL}/{base}", headers=headers).status_code == 204
    ref = client.get(f"{RECIPES_URL}/{parent_id}", headers=headers).json()
    linked = ref["ingredientGroups"][0]["ingredients"][0]["refRecipe"]
    assert linked["id"] is None
    assert linked["title"] == "自家製だれ"
