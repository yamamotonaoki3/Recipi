"""非公開側（`private/`）の画像配信の結合テスト（Issue #185）。

実 PostgreSQL ＋ 実 MinIO に対して実行する（`@pytest.mark.integration`）。

## この Issue で何を守ろうとしているか

- **バケットは非公開**にして、`private/` の画像は**署名付き URL でしか取れない**ようにする
- アバターだけは `uploads/` に残し、CDN が効く**安定 URL**のままにする

## 守れないこと（テストでも仕様として確認する）

署名付き URL は「バケットの非公開化」であって「**URL を知っている人に対する
アクセス制御**」ではない。URL が漏れれば、期限内は誰でも取得できる。
「非公開レシピの情報を第三者に返さない」のは **API の可視性制御の責務**なので、
このファイルの「認可境界」の節で別途確かめる。
"""

from __future__ import annotations

import io
import time
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import storage
from app.config import settings
from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

IMAGES_URL = "/api/v1/images"
RECIPES_URL = "/api/v1/recipes"
AVATAR_URL = "/api/v1/users/me/avatar"


def png_bytes(size: tuple[int, int] = (60, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 160, 90)).save(buf, "PNG")
    return buf.getvalue()


def upload_image(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    """`POST /images` で 1 枚アップロードし、`{key, url}` を返す。"""
    res = client.post(
        IMAGES_URL, headers=headers, files={"file": ("photo.png", png_bytes(), "image/png")}
    )
    assert res.status_code == 201, res.text
    body: dict[str, str] = res.json()
    return body


def stable_url(key: str) -> str:
    """安定 URL（＝公開経路）の形を組み立てる。取得できてはいけない確認に使う。"""
    return f"{settings.S3_PUBLIC_URL_BASE.rstrip('/')}/{key}"


# --- 署名付き URL で実際に取得できるか -------------------------------------


def test_privateの署名付きURLで実際に画像を取得できる(client: TestClient) -> None:
    headers = auth_headers(client)
    body = upload_image(client, headers)

    assert body["key"].startswith("private/")

    res = httpx.get(body["url"])
    assert res.status_code == 200, f"署名付き URL で取得できない: {res.status_code}"
    # 中身はサーバーが再エンコードしたもの（EXIF を落とし、長辺を縮小する。
    # app/services/image.py）なので、アップロードした元バイトとは一致しない。
    assert res.content.startswith(b"\x89PNG"), "PNG が返っていない"
    assert len(res.content) > 0


def test_署名付きURLはpath形式のエンドポイントを指す(client: TestClient) -> None:
    """MinIO はバケット名をホスト名に入れられないので path 形式である必要がある。

    別のクライアントで署名を作ると設定がずれて署名が合わなくなるため、
    `storage.get_s3_client()` と同じものを使っていることをここで担保する。
    """
    headers = auth_headers(client)
    body = upload_image(client, headers)

    assert settings.S3_ENDPOINT_URL.strip(), (
        "このテストは MinIO（S3_ENDPOINT_URL あり）を前提にしている"
    )
    # 署名はブラウザから届くホスト（S3_PUBLIC_URL_BASE の origin）で行う（Issue #268）。
    parts = urlsplit(settings.S3_PUBLIC_URL_BASE)
    origin = f"{parts.scheme}://{parts.netloc}"
    assert body["url"].startswith(f"{origin}/{settings.S3_BUCKET}/"), body["url"]
    assert body["key"] in body["url"]


def test_期限が切れた署名付きURLでは取得できない(client: TestClient) -> None:
    headers = auth_headers(client)
    key = upload_image(client, headers)["key"]

    # 有効期限 1 秒の URL を作り、過ぎてから取りに行く。
    url = storage.presigned_url(key, 1)
    assert httpx.get(url).status_code == 200, "作った直後は取得できるはず"

    time.sleep(2)

    expired = httpx.get(url)
    assert expired.status_code >= 400, "期限切れの URL で取得できてしまう"


# --- 公開経路から漏れていないか --------------------------------------------


def test_privateの画像は安定URLでは取得できない(client: TestClient) -> None:
    """これがこの Issue の肝。`private/` は公開読み取りを許していない。"""
    headers = auth_headers(client)
    key = upload_image(client, headers)["key"]

    res = httpx.get(stable_url(key))
    assert res.status_code >= 400, "非公開のはずの画像が公開経路から取得できてしまう"


def test_公開ポリシーにprivateが含まれない() -> None:
    """`ensure_bucket()` が付ける公開ポリシーの対象は `uploads/` だけ。"""
    policy = storage._public_read_policy()
    assert "uploads/" in policy
    assert "private/" not in policy, "公開ポリシーが private/ を巻き込んでいる"


def test_アバターはuploadsに置かれ安定URLで取得できる(client: TestClient) -> None:
    headers = auth_headers(client)
    res = client.put(
        AVATAR_URL, headers=headers, files={"file": ("a.png", png_bytes(), "image/png")}
    )
    assert res.status_code == 200, res.text

    avatar_url = res.json()["avatarUrl"]
    # アバターは CDN が効く安定 URL のまま（署名を付けない）。
    assert "X-Amz-Signature=" not in avatar_url
    assert avatar_url.startswith(settings.S3_PUBLIC_URL_BASE.rstrip("/"))
    assert "/uploads/" in avatar_url
    assert httpx.get(avatar_url).status_code == 200


# --- API の応答に入る URL の種類 -------------------------------------------


def test_レシピの応答のサムネURLは署名付きになる(client: TestClient) -> None:
    headers = auth_headers(client)
    key = upload_image(client, headers)["key"]

    created = client.post(RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=key))
    assert created.status_code == 201, created.text

    detail = client.get(f"{RECIPES_URL}/{created.json()['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    thumbnail_url = detail.json()["thumbnailUrl"]
    assert "X-Amz-Signature=" in thumbnail_url, "レシピ画像に署名が付いていない"


def test_公開と非公開を切り替えてもキーは変わらない(client: TestClient) -> None:
    """置き場所を動かさない設計であることの確認（Issue #185 の第 2 版で移動案を破棄した）。"""
    headers = auth_headers(client)
    key = upload_image(client, headers)["key"]

    created = client.post(
        RECIPES_URL, headers=headers, json=recipe_payload(isPublic=True, thumbnailKey=key)
    )
    recipe_id = created.json()["id"]

    updated = client.put(
        f"{RECIPES_URL}/{recipe_id}",
        headers=headers,
        json=recipe_payload(isPublic=False, thumbnailKey=key),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["thumbnailKey"] == key, "公開状態の切り替えでキーが動いている"


# --- 認可境界（署名付き URL とは別軸） --------------------------------------


def test_非公開レシピは第三者から取得できず画像URLも返らない(client: TestClient) -> None:
    owner = auth_headers(client)
    key = upload_image(client, owner)["key"]
    created = client.post(
        RECIPES_URL, headers=owner, json=recipe_payload(isPublic=False, thumbnailKey=key)
    )
    recipe_id = created.json()["id"]

    # 本人は見られる
    assert client.get(f"{RECIPES_URL}/{recipe_id}", headers=owner).status_code == 200

    # 第三者には存在を伏せて 404（＝画像 URL も渡らない）
    stranger = auth_headers(client, display_name="別の人")
    res = client.get(f"{RECIPES_URL}/{recipe_id}", headers=stranger)
    assert res.status_code == 404
    assert key not in res.text, "応答に画像キーが漏れている"


def test_アプリのアクセスログに署名が出ない(client: TestClient, json_logs) -> None:
    """署名はクエリ文字列に入るため、ログに残ると URL をそのまま使い回せてしまう。

    アプリのアクセスログはルートのパスだけを記録する（app/middleware.py）ので、
    ここではその回帰を見る。ストレージ側（S3 / MinIO / CloudFront）のログは
    別管理なので、実環境での扱いは Issue #184 で確認する。
    """
    headers = auth_headers(client)
    body = upload_image(client, headers)

    assert "X-Amz-Signature=" in body["url"], "前提が崩れている（署名付き URL が返っていない）"
    assert "X-Amz-Signature" not in json_logs.raw(), "ログに署名が残っている"
    assert "X-Amz-Credential" not in json_logs.raw()


def test_他人の画像キーを自分のレシピに紐付けられない(client: TestClient) -> None:
    """画像キーを知っていても、それだけでは自分のものにできない（既存の検証の回帰）。"""
    owner = auth_headers(client)
    key = upload_image(client, owner)["key"]

    stranger = auth_headers(client, display_name="別の人")
    res = client.post(RECIPES_URL, headers=stranger, json=recipe_payload(thumbnailKey=key))
    assert res.status_code == 400
