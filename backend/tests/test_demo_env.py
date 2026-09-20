"""README用のローカルデモ環境ファイル生成のテスト。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

from scripts.create_demo_env import create_demo_env, render_demo_env


def test_demo_environment_does_not_initialize_minio() -> None:
    """デモはDB専用なので、起動時にMinIOを初期化しない。"""
    from app.main import should_initialize_local_storage

    assert should_initialize_local_storage("development") is True
    assert should_initialize_local_storage("demo") is False
    assert should_initialize_local_storage("production") is False


def test_render_demo_env_uses_isolated_database_and_stub_provider() -> None:
    content = render_demo_env(
        database_password="db-secret",
        minio_password="minio-secret",
        jwt_secret="jwt-secret",
        log_hash_secret="log-secret",
    )

    assert "APP_ENV=demo" in content
    assert (
        "DATABASE_URL=postgresql+psycopg://recipi_demo_user:db-secret@localhost:5433/recipi_demo"
        in content
    )
    assert "POSTGRES_DB=recipi_demo" in content
    assert "AI_PROVIDER=stub" in content
    assert "CORS_ALLOW_ORIGINS=http://localhost:8081,http://localhost:8082" in content
    assert "S3_ENDPOINT_URL=http://localhost:9002" in content
    assert "S3_BUCKET=recipi-demo-images" in content
    assert "MINIO_ROOT_USER=recipi_demo_minio" in content


def test_create_demo_env_refuses_to_overwrite_existing_file() -> None:
    target = Mock(spec=Path)
    target.exists.return_value = True

    created = create_demo_env(target)

    assert created is False
    target.write_text.assert_not_called()


def test_create_demo_env_writes_a_new_file() -> None:
    target = Mock(spec=Path)
    target.exists.return_value = False

    created = create_demo_env(target)

    assert created is True
    content = target.write_text.call_args.args[0]
    assert "APP_ENV=demo" in content
    assert "localhost:5433/recipi_demo" in content
