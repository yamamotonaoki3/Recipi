"""ローカル性能データに対して読み取り専用の実行計画を出力する。

実行例（backend ディレクトリ）::

    APP_ENV=development python -m scripts.explain_perf

性能 seed（``[PERF_TEST]``）が入ったローカル PostgreSQL だけを対象にする。
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from scripts.cleanup_e2e import CleanupError, assert_cleanup_target


@dataclass(frozen=True)
class ExplainQuery:
    """実行計画として出力する、名前付きの読み取り専用クエリ。"""

    name: str
    sql: str
    parameters: dict[str, Any]


def build_explain_queries(recipe_id: str, search_term: str) -> list[ExplainQuery]:
    """フィード・検索・詳細画面の主要SQLを EXPLAIN 用に組み立てる。"""

    pattern = f"%{search_term}%"
    return [
        ExplainQuery(
            "feed",
            """EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_id, title, thumbnail_key, favorite_count, created_at
FROM recipes
WHERE is_public = true
ORDER BY created_at DESC, id DESC
LIMIT 21""",
            {},
        ),
        ExplainQuery(
            "search",
            """EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.user_id, r.title, r.thumbnail_key, r.favorite_count, r.created_at
FROM recipes AS r
WHERE r.is_public = true
  AND (
    r.title_normalized ILIKE :pattern ESCAPE '\\'
    OR EXISTS (
      SELECT 1
      FROM ingredients AS i
      WHERE i.recipe_id = r.id
        AND i.name_normalized ILIKE :pattern ESCAPE '\\'
    )
  )
ORDER BY r.created_at DESC, r.id DESC
LIMIT 21""",
            {"pattern": pattern},
        ),
        ExplainQuery(
            "detail_recipe",
            """EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_id, title, description, servings, thumbnail_key, favorite_count, comment_count
FROM recipes
WHERE id = :recipe_id""",
            {"recipe_id": recipe_id},
        ),
        ExplainQuery(
            "detail_groups",
            """EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, position
FROM ingredient_groups
WHERE recipe_id = :recipe_id
ORDER BY position""",
            {"recipe_id": recipe_id},
        ),
        ExplainQuery(
            "detail_ingredients",
            """EXPLAIN (ANALYZE, BUFFERS)
SELECT id, group_id, name, quantity, unit, position, ref_recipe_id, ref_recipe_title
FROM ingredients
WHERE recipe_id = :recipe_id
ORDER BY position""",
            {"recipe_id": recipe_id},
        ),
        ExplainQuery(
            "detail_steps",
            """EXPLAIN (ANALYZE, BUFFERS)
SELECT id, body, image_key, position
FROM steps
WHERE recipe_id = :recipe_id
ORDER BY position""",
            {"recipe_id": recipe_id},
        ),
    ]


def _probe_parameters(session: Session) -> tuple[str, str]:
    row = (
        session.execute(
            text(
                """SELECT r.id::text AS recipe_id, i.name_normalized AS search_term
FROM recipes AS r
JOIN ingredients AS i ON i.recipe_id = r.id
WHERE r.title LIKE '[PERF_TEST]%'
ORDER BY r.created_at DESC
LIMIT 1"""
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise CleanupError(
            "性能データがありません。先に `python -m scripts.seed_perf --yes` を実行してください。"
        )
    return str(row["recipe_id"]), str(row["search_term"])


def render_report(session: Session) -> str:
    """実行計画をMarkdownに整形する。クエリはすべてEXPLAINで読み取り専用。"""

    recipe_id, search_term = _probe_parameters(session)
    sections = ["# ローカル性能DBのSQL実行計画", ""]
    for query in build_explain_queries(recipe_id, search_term):
        plan = session.execute(text(query.sql), query.parameters).scalars().all()
        sections.extend([f"## {query.name}", "```text", *plan, "```", ""])
    return "\n".join(sections)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ローカル性能DBの EXPLAIN ANALYZE を出力する")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    _parse_args(argv)
    from app.config import settings
    from app.db import engine

    try:
        assert_cleanup_target(settings.APP_ENV, settings.DATABASE_URL)
    except CleanupError as exc:
        print(str(exc).replace("E2E の後始末", "SQL計測"))
        return 1

    with Session(engine) as session:
        try:
            print(render_report(session))
        except CleanupError as exc:
            print(str(exc))
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
