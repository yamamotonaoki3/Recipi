"""開発環境だけで実行する起動処理。"""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)
_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def apply_development_migrations() -> None:
    """development 起動時に Alembic を head まで進める。

    test / demo / production はそれぞれの既存の実行経路を持つため対象外にする。
    開発用 DB のスキーマが古いまま API が起動すると、実行時に 500 になるため、
    migration が失敗した場合は起動そのものを失敗させる。
    """
    if settings.APP_ENV != "development":
        return

    logger.info("applying development database migrations")
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=_BACKEND_ROOT,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        logger.error("development database migrations failed", exc_info=True)
        raise RuntimeError("開発用データベースのマイグレーションに失敗しました") from exc
