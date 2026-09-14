"""デモ seed の安全ガードの単体テスト。"""

from __future__ import annotations

import pytest

from scripts.seed_demo import assert_demo_target


def test_demo_seed_accepts_demo_environment_and_database() -> None:
    assert_demo_target("demo", "postgresql+psycopg://user:password@localhost:5432/recipi_demo")


@pytest.mark.parametrize(
    ("app_env", "database_url"),
    [
        ("development", "postgresql+psycopg://user:password@localhost:5432/recipi_demo"),
        ("demo", "postgresql+psycopg://user:password@localhost:5432/recipi"),
        ("production", "postgresql+psycopg://user:password@localhost:5432/recipi_demo"),
    ],
)
def test_demo_seed_rejects_non_demo_target(app_env: str, database_url: str) -> None:
    with pytest.raises(RuntimeError, match="デモ seed"):
        assert_demo_target(app_env, database_url)
