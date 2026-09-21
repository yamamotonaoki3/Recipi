"""app/storage.py の S3 クライアントの組み立ての単体テスト（DB・MinIO 不要。Issue #166）。

ローカル（MinIO）と本番（AWS の S3 ＋ タスクロール）で、boto3 に渡す引数が
正しく切り替わることを確かめる。値はすべて架空のテスト用。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app import storage


def _settings(**overrides: str) -> Any:
    """_client_kwargs が読む項目だけを持つ、テスト用の設定。"""
    values = {
        "S3_ENDPOINT_URL": "http://localhost:9000",
        "S3_PUBLIC_URL_BASE": "http://localhost:9000/recipi-images",
        "S3_REGION": "us-east-1",
        "S3_ACCESS_KEY_ID": "testkey",
        "S3_SECRET_ACCESS_KEY": "testsecret",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_minio_uses_endpoint_keys_and_path_style():
    kwargs = storage._client_kwargs(_settings())

    assert kwargs["endpoint_url"] == "http://localhost:9000"
    assert kwargs["aws_access_key_id"] == "testkey"
    assert kwargs["aws_secret_access_key"] == "testsecret"
    assert kwargs["region_name"] == "us-east-1"
    assert kwargs["config"].s3 == {"addressing_style": "path"}


def test_aws_with_empty_endpoint_and_keys_uses_default_credential_chain():
    """エンドポイントとキーが空なら None を渡し、タスクロール（既定の認証情報チェーン）を使う。"""
    kwargs = storage._client_kwargs(
        _settings(
            S3_ENDPOINT_URL="",
            S3_ACCESS_KEY_ID="",
            S3_SECRET_ACCESS_KEY="",
            S3_REGION="ap-northeast-1",
        )
    )

    assert kwargs["endpoint_url"] is None
    assert kwargs["aws_access_key_id"] is None
    assert kwargs["aws_secret_access_key"] is None
    assert kwargs["region_name"] == "ap-northeast-1"
    # AWS の S3 では path 形式を指定しない（既定の virtual-hosted に任せる）。
    assert not kwargs["config"].s3


def test_presign_signs_with_the_browser_reachable_host_not_the_internal_one():
    """コンテナ間の宛先（minio:9000）ではなく、ブラウザ向けのホストで署名する（Issue #268）。"""
    s = _settings(S3_ENDPOINT_URL="http://minio:9000")

    assert storage._client_kwargs(s)["endpoint_url"] == "http://minio:9000"
    presign = storage._client_kwargs(s, for_presign=True)
    assert presign["endpoint_url"] == "http://localhost:9000"
    assert presign["config"].s3 == {"addressing_style": "path"}
    assert presign["aws_access_key_id"] == "testkey"


def test_presign_on_aws_keeps_default_endpoint():
    kwargs = storage._client_kwargs(
        _settings(S3_ENDPOINT_URL="", S3_ACCESS_KEY_ID="", S3_SECRET_ACCESS_KEY=""),
        for_presign=True,
    )
    assert kwargs["endpoint_url"] is None
    assert not kwargs["config"].s3


def test_presigned_url_host_is_the_public_host(monkeypatch: pytest.MonkeyPatch):
    from app.config import settings

    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "http://minio:9000")
    monkeypatch.setattr(settings, "S3_PUBLIC_URL_BASE", "http://localhost:9000/recipi-images")
    storage.get_presign_client.cache_clear()
    try:
        url = storage.presigned_url("private/x.png", 60)
    finally:
        storage.get_presign_client.cache_clear()
    assert url.startswith("http://localhost:9000/")


@pytest.mark.parametrize(
    ("key_id", "secret"),
    [("testkey", ""), ("", "testsecret")],
)
def test_only_one_of_the_keys_is_a_config_error(key_id: str, secret: str):
    with pytest.raises(ValueError, match="両方"):
        storage._client_kwargs(_settings(S3_ACCESS_KEY_ID=key_id, S3_SECRET_ACCESS_KEY=secret))


def test_ensure_bucket_does_nothing_in_production(monkeypatch: pytest.MonkeyPatch):
    """production ではバケットの作成も公開ポリシーの設定もしない（S3 に触れない）。"""
    from app.config import settings

    def fail_if_called() -> Any:
        raise AssertionError("production で S3 クライアントを作ってはいけない")

    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(storage, "get_s3_client", fail_if_called)

    storage.ensure_bucket()  # 例外にならずに戻る
