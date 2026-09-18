"""development 起動時の初期化処理を、実 DB や Ollama なしで確認する。"""

from __future__ import annotations

import subprocess
from unittest.mock import Mock

import pytest

from app.config import settings
from app.startup import apply_development_migrations


def test_development_startup_applies_alembic_head(monkeypatch: pytest.MonkeyPatch) -> None:
    """development は API を受け付ける前に head まで migration する。"""
    run = Mock()
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(settings, "APP_ENV", "development")

    apply_development_migrations()

    command = run.call_args.args[0]
    assert command[-3:] == ["alembic", "upgrade", "head"]
    assert run.call_args.kwargs["check"] is True


@pytest.mark.parametrize("app_env", ["test", "demo", "production"])
def test_startup_migrations_skip_non_development(
    monkeypatch: pytest.MonkeyPatch, app_env: str
) -> None:
    """test/demo/production の migration 実行経路は既存のまま維持する。"""
    run = Mock()
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(settings, "APP_ENV", app_env)

    apply_development_migrations()

    run.assert_not_called()


def test_development_startup_stops_when_migration_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """migration失敗時は古いスキーマで API を起動しない。"""

    def fail(*args: object, **kwargs: object) -> None:
        raise subprocess.CalledProcessError(returncode=1, cmd="alembic")

    monkeypatch.setattr(subprocess, "run", fail)
    monkeypatch.setattr(settings, "APP_ENV", "development")

    with pytest.raises(RuntimeError, match="マイグレーション"):
        apply_development_migrations()
