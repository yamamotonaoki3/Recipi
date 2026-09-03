"""pytest 共通の準備（fixture）。

このファイルは pytest が「テストを集める前」に読み込む。
ここで **APP_ENV=test を強制**することで、`pytest` とだけ打っても
開発用 DB（.env.development）につながないようにする（environment.md §1）。
"""

from __future__ import annotations

import os
from pathlib import Path

# ---- ここは import の前に実行される。順序が重要。 ----------------------
os.environ["APP_ENV"] = "test"

_REPO_ROOT = Path(__file__).resolve().parents[2]

# .env.test が無い環境（新規クローンなど）向けのフォールバック値。
# CI は .env.test を生成するので、CI ではこの分岐は通らない。
# .env.test があるときは os.environ をいじらない（.env.test の値を使わせる）。
if not (_REPO_ROOT / ".env.test").exists():
    _fallback = {
        "DATABASE_URL": ("postgresql+psycopg://recipi_test:recipi_test@localhost:5432/recipi_test"),
        "JWT_SECRET_KEY": "test-only-not-a-real-secret",
        "S3_ACCESS_KEY_ID": "test",
        "S3_SECRET_ACCESS_KEY": "test",
        "AI_PROVIDER": "stub",
        "LOG_LEVEL": "WARNING",
    }
    for _k, _v in _fallback.items():
        os.environ.setdefault(_k, _v)
# ---------------------------------------------------------------------

import pytest  # noqa: E402  （上の環境変数設定より後に import したいので許容）
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _guard_against_non_test_database() -> None:
    """テストが本番 / ステージング / 開発 DB につながないことを保証する安全網。

    environment.md §1・non-functional.md「テストは本番・ステージング DB に
    接続しない」。DATABASE_URL が環境から継承されているケース（例:
    `DATABASE_URL=<本番> pytest`）を弾く。DB 名に "test" を含むものだけ許可。
    """
    from app.config import settings

    db_name = settings.DATABASE_URL.rsplit("/", 1)[-1].split("?", 1)[0]
    if "test" not in db_name.lower():
        pytest.exit(
            f"テスト用でない DATABASE_URL を検出しました（DB 名: '{db_name}'）。\n"
            "APP_ENV=test で .env.test の使い捨て DB（名前に 'test' を含む）を"
            "指してください。",
            returncode=3,
        )


@pytest.fixture
def client() -> TestClient:
    """FastAPI アプリを HTTP で叩くテスト用クライアント。

    `app` の import はこの fixture の中で行う（APP_ENV=test が
    設定済みの状態で読み込ませるため）。
    """
    from app.main import app

    return TestClient(app)
