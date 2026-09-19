"""性能データに対する SQL 実行計画の計測スクリプトのテスト。"""

from scripts.explain_perf import build_explain_queries


def test_explain_queries_cover_feed_search_and_detail_without_writes() -> None:
    queries = build_explain_queries(recipe_id="recipe-id", search_term="玉ねぎ")

    assert {query.name for query in queries} == {
        "feed",
        "search",
        "detail_recipe",
        "detail_groups",
        "detail_ingredients",
        "detail_steps",
    }
    assert all(query.sql.lstrip().startswith("EXPLAIN (ANALYZE, BUFFERS)") for query in queries)
    assert all("INSERT" not in query.sql and "UPDATE" not in query.sql for query in queries)
