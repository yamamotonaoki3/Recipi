"""app/config.py の単体テスト（ホワイトボックス: 分岐・境界を確認）。"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings, env_file_for


def test_settings_reflect_test_env(client):
    """conftest が APP_ENV=test にしているので、設定もそれを反映する。"""
    from app.config import settings

    assert settings.APP_ENV == "test"
    assert settings.is_test is True


@pytest.mark.parametrize("app_env", ["development", "demo", "test", "production"])
def test_env_file_path_follows_app_env(app_env: str):
    """APP_ENV ごとに `.env.<APP_ENV>` を指す（分岐の確認）。"""
    path = env_file_for(app_env)
    assert path.name == f".env.{app_env}"
    assert path.parent == Path(__file__).resolve().parents[2]  # リポジトリルート直下


def test_missing_required_setting_raises(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """DATABASE_URL が環境変数にも .env にも無いと ValidationError。"""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    # 実在しない .env ファイルを指させて「ファイルからも読めない」状態にする。
    empty_env = tmp_path / ".env.test"

    with pytest.raises(ValidationError):
        Settings(_env_file=empty_env)


def test_ai_provider_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """AI_PROVIDER は local/anthropic/stub のみ許可（Literal の境界）。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("AI_PROVIDER", "openai")  # 許可外

    with pytest.raises(ValidationError):
        Settings(_env_file=tmp_path / ".env.missing")


def test_production_rejects_dummy_jwt_secret(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """production ではダミーの JWT_SECRET_KEY で起動できない（分岐の確認）。"""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)  # デフォルト値のまま

    with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
        Settings(_env_file=tmp_path / ".env.missing")


def test_production_accepts_strong_jwt_secret(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """production でも十分な長さの本物の鍵なら起動できる。"""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("LOG_HASH_SECRET", "y" * 40)
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    _set_valid_production_storage(monkeypatch)

    s = Settings(_env_file=tmp_path / ".env.missing")
    assert s.APP_ENV == "production"


def _set_valid_production_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    """本番の画像保存とクライアント IP に必要な値（Issue #166）を、架空の正しい値で入れる。"""
    monkeypatch.setenv("S3_ENDPOINT_URL", "")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "")
    monkeypatch.setenv("S3_REGION", "ap-northeast-1")
    monkeypatch.setenv("S3_BUCKET", "testuser-images-bucket")
    monkeypatch.setenv("S3_PUBLIC_URL_BASE", "https://images.example.com")
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.20.10.0/24,10.20.11.0/24")


def _set_valid_production_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("LOG_HASH_SECRET", "y" * 40)
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("S3_REGION", "", "S3_REGION"),
        ("S3_BUCKET", "", "S3_BUCKET"),
        ("S3_PUBLIC_URL_BASE", "", "S3_PUBLIC_URL_BASE"),
        ("S3_PUBLIC_URL_BASE", "http://images.example.com", "https://"),
        ("TRUSTED_PROXY_CIDRS", "", "TRUSTED_PROXY_CIDRS"),
        ("S3_ACCESS_KEY_ID", "testkey", "両方"),
    ],
)
def test_production_rejects_missing_storage_settings(
    monkeypatch: pytest.MonkeyPatch, tmp_path, name: str, value: str, message: str
):
    """production で画像保存・クライアント IP に必要な値が欠けると起動できない（Issue #166）。"""
    _set_valid_production_secrets(monkeypatch)
    _set_valid_production_storage(monkeypatch)
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError, match=message):
        Settings(_env_file=tmp_path / ".env.missing")


def test_invalid_trusted_proxy_cidrs_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """TRUSTED_PROXY_CIDRS の書き間違いは、どの環境でも起動時にエラーにする。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.20.10.0/24,not-a-cidr")

    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        Settings(_env_file=tmp_path / ".env.missing")


def test_trusted_proxy_cidrs_are_parsed(monkeypatch: pytest.MonkeyPatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", " 10.20.10.0/24 , 10.20.11.0/24 ")

    s = Settings(_env_file=tmp_path / ".env.missing")
    assert [str(n) for n in s.trusted_proxy_networks] == ["10.20.10.0/24", "10.20.11.0/24"]


@pytest.mark.parametrize("log_hash_secret", [None, "changeme", "short-secret"])
def test_production_rejects_weak_log_hash_secret(
    monkeypatch: pytest.MonkeyPatch, tmp_path, log_hash_secret: str | None
):
    """production では LOG_HASH_SECRET が未設定・ダミー・短すぎると起動できない（Issue #170）。"""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    if log_hash_secret is None:
        monkeypatch.delenv("LOG_HASH_SECRET", raising=False)  # デフォルト値のまま
    else:
        monkeypatch.setenv("LOG_HASH_SECRET", log_hash_secret)

    with pytest.raises(ValidationError, match="LOG_HASH_SECRET"):
        Settings(_env_file=tmp_path / ".env.missing")


def test_non_production_allows_default_jwt_secret(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """development / test はダミー鍵でも起動できる（検証をスキップする分岐）。"""
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)

    s = Settings(_env_file=tmp_path / ".env.missing")
    assert s.JWT_SECRET_KEY == "dev-only-not-a-real-secret"


@pytest.mark.parametrize(
    "name",
    [
        "NOTIFICATION_READ_RETENTION_DAYS",
        "OUTBOX_PROCESSED_RETENTION_DAYS",
        "REFRESH_TOKEN_EXPIRED_RETENTION_DAYS",
        "RECIPE_VIEWS_MAX_PER_USER",
        "PASSWORD_RESET_ATTEMPT_RETENTION_DAYS",
    ],
)
@pytest.mark.parametrize("value", ["0", "-1"])
def test_cleanup_settings_reject_non_positive(
    monkeypatch: pytest.MonkeyPatch, tmp_path, name: str, value: str
):
    """保持期間・上限は 1 以上（0 や負だと必要な行まで消すので起動時に弾く。Issue #72）。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError):
        Settings(_env_file=tmp_path / ".env.missing")


def test_cleanup_settings_defaults_and_override(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """既定値（90 / 7 / 30 / 200 / 1）で読め、環境変数で上書きできる（Issue #72・#85）。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    for name in (
        "NOTIFICATION_READ_RETENTION_DAYS",
        "OUTBOX_PROCESSED_RETENTION_DAYS",
        "REFRESH_TOKEN_EXPIRED_RETENTION_DAYS",
        "RECIPE_VIEWS_MAX_PER_USER",
        "PASSWORD_RESET_ATTEMPT_RETENTION_DAYS",
    ):
        monkeypatch.delenv(name, raising=False)
    s = Settings(_env_file=tmp_path / ".env.missing")
    assert (
        s.NOTIFICATION_READ_RETENTION_DAYS,
        s.OUTBOX_PROCESSED_RETENTION_DAYS,
        s.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS,
        s.RECIPE_VIEWS_MAX_PER_USER,
        s.PASSWORD_RESET_ATTEMPT_RETENTION_DAYS,
    ) == (90, 7, 30, 200, 1)

    monkeypatch.setenv("RECIPE_VIEWS_MAX_PER_USER", "50")
    assert Settings(_env_file=tmp_path / ".env.missing").RECIPE_VIEWS_MAX_PER_USER == 50


@pytest.mark.parametrize("value", ["0", "-1", "604801"])
def test_image_url_ttl_rejects_invalid_values(
    monkeypatch: pytest.MonkeyPatch, tmp_path, value: str
):
    """画像 URL の有効期限は 1 秒以上 7 日以下で、範囲外なら起動できない。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("IMAGE_URL_TTL_SECONDS", value)

    with pytest.raises(ValidationError):
        Settings(_env_file=tmp_path / ".env.missing")


@pytest.mark.parametrize("value", ["1", "3600", "604800"])
def test_image_url_ttl_accepts_valid_values(monkeypatch: pytest.MonkeyPatch, tmp_path, value: str):
    """画像 URL の有効期限は 1 秒以上 7 日以下なら起動できる。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    monkeypatch.setenv("IMAGE_URL_TTL_SECONDS", value)

    settings = Settings(_env_file=tmp_path / ".env.missing")

    assert settings.IMAGE_URL_TTL_SECONDS == int(value)
