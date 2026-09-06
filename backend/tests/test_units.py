"""GET /api/v1/units ＋ レシピ保存時の単位自動 upsert の結合テスト。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.models.unit import Unit
from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"
UNITS_URL = "/api/v1/units"


def test_units_returns_seeded_master(client: TestClient) -> None:
    res = client.get(UNITS_URL)
    assert res.status_code == 200
    units = res.json()["units"]
    by_value = {u["value"]: u["placement"] for u in units}
    assert by_value["g"] == "suffix"
    assert by_value["大さじ"] == "prefix"
    assert by_value["小さじ"] == "prefix"
    assert by_value["少々"] == "suffix"


def test_free_typed_unit_is_added_and_appears_next_time(client: TestClient) -> None:
    headers = auth_headers(client)
    payload = recipe_payload(
        ingredientGroups=[
            {
                "name": None,
                "ingredients": [{"name": "特殊調味料", "quantity": 1, "unit": "さじ加減"}],
            }
        ]
    )
    res = client.post(RECIPES_URL, json=payload, headers=headers)
    assert res.status_code == 201, res.text

    values = {u["value"] for u in client.get(UNITS_URL).json()["units"]}
    assert "さじ加減" in values


def test_normalized_key_dedupes_full_width(client: TestClient, db_session) -> None:
    """'g' と全角 'ｇ' は正規化キーが同じなので units に重複行が増えない。"""
    headers = auth_headers(client)
    payload = recipe_payload(
        ingredientGroups=[
            {"name": None, "ingredients": [{"name": "砂糖", "quantity": 5, "unit": "ｇ"}]}
        ]
    )
    assert client.post(RECIPES_URL, json=payload, headers=headers).status_code == 201

    rows = db_session.exec(select(Unit).where(Unit.normalized == "g")).all()
    assert len(rows) == 1


def test_different_notation_is_kept_separately(client: TestClient, db_session) -> None:
    """'g' と 'グラム' は別表記なので両方候補に残る。"""
    headers = auth_headers(client)
    payload = recipe_payload(
        ingredientGroups=[
            {"name": None, "ingredients": [{"name": "塩", "quantity": 2, "unit": "グラム"}]}
        ]
    )
    assert client.post(RECIPES_URL, json=payload, headers=headers).status_code == 201

    values = {u["value"] for u in client.get(UNITS_URL).json()["units"]}
    assert "g" in values
    assert "グラム" in values
