"""リクエスト単位の DB クエリ数・処理時間を記録する。

SQL の本文やパラメータは記録しない。性能調査に必要な集計値だけを
ContextVar 経由でリクエストのアクセスログへ渡す。
"""

from __future__ import annotations

import time
from contextvars import ContextVar, Token
from typing import Any

_metrics: ContextVar[dict[str, Any] | None] = ContextVar("db_metrics", default=None)


def start_db_metrics() -> Token[dict[str, Any] | None]:
    """リクエストのDB集計を開始する。"""
    return _metrics.set({"query_count": 0, "duration_ms": 0.0, "started": []})


def reset_db_metrics(token: Token[dict[str, Any] | None]) -> None:
    _metrics.reset(token)


def db_metrics() -> dict[str, int | float]:
    """現在のリクエストの集計値を返す。リクエスト外ではゼロを返す。"""
    metrics = _metrics.get()
    if metrics is None:
        return {"query_count": 0, "duration_ms": 0.0}
    return {
        "query_count": int(metrics["query_count"]),
        "duration_ms": round(float(metrics["duration_ms"]), 1),
    }


def before_query() -> None:
    metrics = _metrics.get()
    if metrics is not None:
        metrics["started"].append(time.perf_counter())


def after_query() -> None:
    metrics = _metrics.get()
    if metrics is not None:
        started = metrics["started"].pop() if metrics["started"] else None
        if started is not None:
            metrics["duration_ms"] += (time.perf_counter() - started) * 1000
        metrics["query_count"] += 1
