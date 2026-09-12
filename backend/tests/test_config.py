"""app/config.py の単体テスト（ホワイトボックス: 分岐・境界を確認）。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings, env_file_for


def test_settings_reflect_test_env(client):
    """conftest が APP_ENV=test にしているので、設定もそれを反映する。"""
    from app.config import settings

    assert settings.APP_ENV == "test"
    assert settings.is_test is True


@pytest.mark.parametrize("app_env", ["development", "test", "production"])
def test_env_file_path_follows_app_env(app_env: str):
    """APP_ENV ごとに `.env.<APP_ENV>` を指す（分岐の確認）。"""
    path = env_file_for(app_env)
    assert path.name == f".env.{app_env}"
    assert path.parent.name == "Recipi"  # リポジトリルート直下


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

    s = Settings(_env_file=tmp_path / ".env.missing")
    assert s.APP_ENV == "production"


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
    """既定値（90 / 7 / 30 / 200）で読め、環境変数で上書きできる（Issue #72）。"""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d")
    for name in (
        "NOTIFICATION_READ_RETENTION_DAYS",
        "OUTBOX_PROCESSED_RETENTION_DAYS",
        "REFRESH_TOKEN_EXPIRED_RETENTION_DAYS",
        "RECIPE_VIEWS_MAX_PER_USER",
    ):
        monkeypatch.delenv(name, raising=False)
    s = Settings(_env_file=tmp_path / ".env.missing")
    assert (
        s.NOTIFICATION_READ_RETENTION_DAYS,
        s.OUTBOX_PROCESSED_RETENTION_DAYS,
        s.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS,
        s.RECIPE_VIEWS_MAX_PER_USER,
    ) == (90, 7, 30, 200)

    monkeypatch.setenv("RECIPE_VIEWS_MAX_PER_USER", "50")
    assert Settings(_env_file=tmp_path / ".env.missing").RECIPE_VIEWS_MAX_PER_USER == 50
