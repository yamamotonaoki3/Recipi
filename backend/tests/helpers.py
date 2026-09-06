"""結合テスト用の小さなヘルパー（サインアップして認証ヘッダーを得る等）。"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi.testclient import TestClient

SIGNUP_URL = "/api/v1/auth/signup"
PASSWORD = "TestPass123!"


def signup(client: TestClient, *, display_name: str = "テスト太郎") -> dict[str, Any]:
    """新規ユーザーを作り、signup レスポンス（accessToken 等）を返す。"""
    email = f"testuser_{uuid.uuid4().hex}@example.com"
    res = client.post(
        SIGNUP_URL,
        json={
            "email": email,
            "password": PASSWORD,
            "displayName": display_name,
            "securityQuestion": "好きな食べ物は？",
            "securityAnswer": "ラーメン",
        },
    )
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    body["email"] = email
    return body


def auth_headers(client: TestClient, *, display_name: str = "テスト太郎") -> dict[str, str]:
    token = signup(client, display_name=display_name)["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def recipe_payload(**overrides: Any) -> dict[str, Any]:
    """最小の有効なレシピ body（グループ無し = 名前なしグループ 1 つ）。"""
    payload: dict[str, Any] = {
        "title": "肉じゃが",
        "description": "定番の和食",
        "servings": 2,
        "isPublic": True,
        "ingredientGroups": [
            {
                "name": None,
                "ingredients": [
                    {"name": "じゃがいも", "quantity": 3, "unit": "個"},
                    {"name": "牛肉", "quantity": 200, "unit": "g"},
                ],
            }
        ],
        "steps": [
            {"position": 1, "body": "材料を切る"},
            {"position": 2, "body": "煮る"},
        ],
    }
    payload.update(overrides)
    return payload
