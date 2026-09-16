"""リクエスト単位のDB集計テスト。SQL本文は記録しないことも確認する。"""

from app.db_metrics import after_query, before_query, db_metrics, reset_db_metrics, start_db_metrics


def test_db_metrics_counts_queries_and_duration() -> None:
    token = start_db_metrics()
    try:
        before_query()
        after_query()
        metrics = db_metrics()
        assert metrics["query_count"] == 1
        assert metrics["duration_ms"] >= 0
    finally:
        reset_db_metrics(token)


def test_db_metrics_are_empty_outside_request() -> None:
    assert db_metrics() == {"query_count": 0, "duration_ms": 0.0}
