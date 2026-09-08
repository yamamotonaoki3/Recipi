"""結合テスト用の小さなヘルパー（サインアップして認証ヘッダーを得る等）。"""

from __future__ import annotations

import io
import uuid
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

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


def upload_image(
    client: TestClient, headers: dict[str, str], *, size: tuple[int, int] = (40, 30)
) -> str:
    """画像を 1 枚アップロードして、そのオブジェクトキーを返す（Issue #39）。

    レシピの `thumbnailKey` / `steps[].imageKey` には「本人所有かつ未使用」の
    実在するキーしか指定できない（features/image.md §3）。テストで適当な
    文字列を渡すと 400 になるので、必ずここで実際にアップロードして得た
    キーを使う。
    """
    buf = io.BytesIO()
    Image.new("RGB", size, (40, 150, 90)).save(buf, "PNG")
    res = client.post(
        "/api/v1/images",
        headers=headers,
        files={"file": ("photo.png", buf.getvalue(), "image/png")},
    )
    assert res.status_code == 201, res.text
    key: str = res.json()["key"]
    return key
