"""`POST /images` とレシピへの画像キー紐付けの結合テスト（Issue #39）。

実 PostgreSQL ＋ 実 MinIO に対して実行する（`@pytest.mark.integration`）。
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, select

from app import storage
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload
from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

IMAGES_URL = "/api/v1/images"
RECIPES_URL = "/api/v1/recipes"


def png_bytes(size: tuple[int, int] = (60, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 160, 90)).save(buf, "PNG")
    return buf.getvalue()


def upload(client: TestClient, headers: dict[str, str], data: bytes | None = None) -> str:
    """画像を 1 枚アップロードして key を返す。"""
    res = client.post(
        IMAGES_URL,
        headers=headers,
        files={"file": ("photo.png", data or png_bytes(), "image/png")},
    )
    assert res.status_code == 201, res.text
    key: str = res.json()["key"]
    return key


def upload_row(db_session: Session, key: str) -> Upload | None:
    return db_session.exec(select(Upload).where(Upload.key == key)).first()


def queued_keys(db_session: Session) -> set[str]:
    rows = db_session.exec(select(PendingStorageDeletion)).all()
    return {r.key for r in rows}


# --- POST /images -----------------------------------------------------


def test_画像をアップロードするとkeyとurlが返りオブジェクトが保存される(client, db_session):
    headers = auth_headers(client)
    res = client.post(
        IMAGES_URL, headers=headers, files={"file": ("a.png", png_bytes(), "image/png")}
    )
    assert res.status_code == 201, res.text

    body = res.json()
    assert body["key"].startswith("uploads/")
    assert body["url"].endswith(body["key"])

    # 管理行は stored（本参照待ち）になっている
    row = upload_row(db_session, body["key"])
    assert row is not None
    assert row.status == "stored"
    # オブジェクトが実際にストレージにある
    assert storage.object_exists(body["key"])


def test_認証が無いと401(client):
    res = client.post(IMAGES_URL, files={"file": ("a.png", png_bytes(), "image/png")})
    assert res.status_code == 401


def test_非対応形式は400(client):
    headers = auth_headers(client)
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "GIF")
    res = client.post(
        IMAGES_URL, headers=headers, files={"file": ("a.gif", buf.getvalue(), "image/gif")}
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_中身が画像でなければ拡張子を偽装しても400(client):
    headers = auth_headers(client)
    res = client.post(
        IMAGES_URL, headers=headers, files={"file": ("a.jpg", b"not an image", "image/jpeg")}
    )
    assert res.status_code == 400


# --- レシピへの紐付け（キーの消費） ------------------------------------


def test_レシピ作成でサムネと手順画像が保存され詳細に反映される(client, db_session):
    headers = auth_headers(client)
    thumb, step_img = upload(client, headers), upload(client, headers)

    payload = recipe_payload(thumbnailKey=thumb)
    payload["steps"] = [{"body": "煮る", "imageKey": step_img}]
    res = client.post(RECIPES_URL, headers=headers, json=payload)
    assert res.status_code == 201, res.text

    body = res.json()
    assert body["thumbnailKey"] == thumb
    assert body["thumbnailUrl"].endswith(thumb)
    assert body["steps"][0]["imageKey"] == step_img
    assert body["steps"][0]["imageUrl"].endswith(step_img)

    # 両方とも consumed になっている（GC の対象外になる）
    for key in (thumb, step_img):
        db_session.expire_all()
        row = upload_row(db_session, key)
        assert row is not None and row.status == "consumed"


def test_空白だけの手順に付けた画像キーは消費されない(client, db_session):
    headers = auth_headers(client)
    key = upload(client, headers)
    payload = recipe_payload()
    payload["steps"] = [{"body": "   ", "imageKey": key}, {"body": "煮る"}]

    res = client.post(RECIPES_URL, headers=headers, json=payload)
    assert res.status_code == 201, res.text

    # 空白だけの手順は保存されないので、そこに付いた画像も未使用のままにする。
    db_session.expire_all()
    row = upload_row(db_session, key)
    assert row is not None and row.status == "stored"


def test_他人がアップロードしたキーは400(client):
    owner = auth_headers(client, display_name="所有者")
    other = auth_headers(client, display_name="別人")
    key = upload(client, owner)

    res = client.post(RECIPES_URL, headers=other, json=recipe_payload(thumbnailKey=key))
    assert res.status_code == 400
    assert res.json()["error"]["details"]["imageKey"] == key


def test_既に別のレシピで使用済みのキーは400(client):
    headers = auth_headers(client)
    key = upload(client, headers)

    first = client.post(RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=key))
    assert first.status_code == 201

    second = client.post(RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=key))
    assert second.status_code == 400


def test_存在しないキーは400(client):
    headers = auth_headers(client)
    res = client.post(
        RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey="uploads/does-not-exist.jpg")
    )
    assert res.status_code == 400


def test_同じキーを複数の場所に指定すると400(client):
    headers = auth_headers(client)
    key = upload(client, headers)
    payload = recipe_payload(thumbnailKey=key)
    payload["steps"] = [{"body": "煮る", "imageKey": key}]
    res = client.post(RECIPES_URL, headers=headers, json=payload)
    assert res.status_code == 400


# --- 更新（維持 / 差し替え / 削除の 3 分岐） ---------------------------


def test_同じキーを再送すると維持される(client, db_session):
    headers = auth_headers(client)
    key = upload(client, headers)
    recipe_id = client.post(
        RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=key)
    ).json()["id"]

    res = client.put(
        f"{RECIPES_URL}/{recipe_id}", headers=headers, json=recipe_payload(thumbnailKey=key)
    )
    assert res.status_code == 200
    assert res.json()["thumbnailKey"] == key
    # 維持なので削除キューには積まれない
    db_session.expire_all()
    assert key not in queued_keys(db_session)


def test_サムネを差し替えると旧キーが削除キューに積まれる(client, db_session):
    headers = auth_headers(client)
    old, new = upload(client, headers), upload(client, headers)
    recipe_id = client.post(
        RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=old)
    ).json()["id"]

    res = client.put(
        f"{RECIPES_URL}/{recipe_id}", headers=headers, json=recipe_payload(thumbnailKey=new)
    )
    assert res.status_code == 200
    assert res.json()["thumbnailKey"] == new

    db_session.expire_all()
    assert old in queued_keys(db_session)
    # 旧キーの管理行は役目を終えたので消えている（consumed が溜まらない）
    assert upload_row(db_session, old) is None


def test_サムネをnullにすると削除され旧キーが積まれる(client, db_session):
    headers = auth_headers(client)
    key = upload(client, headers)
    recipe_id = client.post(
        RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=key)
    ).json()["id"]

    res = client.put(
        f"{RECIPES_URL}/{recipe_id}", headers=headers, json=recipe_payload(thumbnailKey=None)
    )
    assert res.status_code == 200
    assert res.json()["thumbnailKey"] is None

    db_session.expire_all()
    assert key in queued_keys(db_session)


def test_thumbnailKey省略ならサムネは維持される(client, db_session):
    headers = auth_headers(client)
    key = upload(client, headers)
    recipe_id = client.post(
        RECIPES_URL, headers=headers, json=recipe_payload(thumbnailKey=key)
    ).json()["id"]

    payload = recipe_payload()
    payload.pop("thumbnailKey", None)
    res = client.put(f"{RECIPES_URL}/{recipe_id}", headers=headers, json=payload)
    assert res.status_code == 200
    assert res.json()["thumbnailKey"] == key

    db_session.expire_all()
    assert key not in queued_keys(db_session)


def test_手順から外れた画像キーは削除キューに積まれる(client, db_session):
    headers = auth_headers(client)
    key = upload(client, headers)
    payload = recipe_payload()
    payload["steps"] = [{"body": "煮る", "imageKey": key}]
    recipe_id = client.post(RECIPES_URL, headers=headers, json=payload).json()["id"]

    # 画像なしの手順に差し替える（手順は全入れ替え）
    without = recipe_payload()
    without["steps"] = [{"body": "煮る"}]
    res = client.put(f"{RECIPES_URL}/{recipe_id}", headers=headers, json=without)
    assert res.status_code == 200

    db_session.expire_all()
    assert key in queued_keys(db_session)


# --- 削除（CASCADE の前にキーを集める） --------------------------------


def test_レシピ削除でサムネと手順画像が削除キューに積まれる(client, db_session):
    headers = auth_headers(client)
    thumb, step_img = upload(client, headers), upload(client, headers)
    payload = recipe_payload(thumbnailKey=thumb)
    payload["steps"] = [{"body": "煮る", "imageKey": step_img}]
    recipe_id = client.post(RECIPES_URL, headers=headers, json=payload).json()["id"]

    res = client.delete(f"{RECIPES_URL}/{recipe_id}", headers=headers)
    assert res.status_code == 204

    db_session.expire_all()
    queued = queued_keys(db_session)
    assert thumb in queued and step_img in queued
    # 管理行も残らない
    assert upload_row(db_session, thumb) is None
    assert upload_row(db_session, step_img) is None
