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


@pytest.fixture(autouse=True)
def _reset_password_reset_attempts(request: pytest.FixtureRequest):
    """結合テストの前に `password_reset_attempts` を空にする。

    `TestClient` はどのテストでも同じダミー IP（"testclient"）を使うため、
    このテーブルの行を残したままにすると、IP 単位のレート制限（app/api/auth.py
    の `_IP_LOCKOUT_MAX_ATTEMPTS`）が別々のテスト実行をまたいで蓄積し、
    本来レート制限を意図していないテストまで 429 になってしまう。

    `@pytest.mark.integration` が付いたテストだけに絞る: DB / マイグレーション
    を必要としない単体テスト（test_config.py 等）は、Docker が無い環境でも
    `pytest -m "not integration"` で動く前提（README・testing.md）なので、
    ここで無条件に DB へ接続すると、その前提を壊してしまう。
    """
    if request.node.get_closest_marker("integration") is None:
        yield
        return

    from sqlmodel import Session, delete

    from app.db import engine
    from app.models.password_reset_attempt import PasswordResetAttempt

    with Session(engine) as session:
        session.exec(delete(PasswordResetAttempt))
        session.commit()
    yield


@pytest.fixture
def unique_email() -> str:
    """テストごとに衝突しないメールアドレスを作る。

    実在しうるドメインを避け、必ず `@example.com`（RFC 2606 予約ドメイン）を
    使う（グローバル CLAUDE.md のテストデータ規約）。
    """
    import uuid

    return f"testuser_{uuid.uuid4().hex}@example.com"


@pytest.fixture
def db_session():
    """テストコードから直接 DB を読み書きするためのセッション。

    アプリの `get_session`（1 リクエスト単位で自動 commit）とは別に、
    テスト側で任意のタイミングで commit したいときに使う
    （例: token_version を直接書き換えて 401 になることを確認する）。
    """
    from sqlmodel import Session

    from app.db import engine

    with Session(engine) as session:
        yield session
