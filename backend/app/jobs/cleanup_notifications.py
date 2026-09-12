"""古い通知と処理済み outbox の掃除（processing-model.md §8。Issue #72）。

## 何を消すか

- **既読になってから 90 日**（`NOTIFICATION_READ_RETENTION_DAYS`）を過ぎた通知。
  未読の通知は、どれだけ古くても消さない（まだ本人が見ていない出来事なので）
- **配り終えてから 7 日**（`OUTBOX_PROCESSED_RETENTION_DAYS`）を過ぎた
  `notification_outbox` の行。未処理の行は消さない（スイープがまだ配るかもしれない）

## なぜ即時に消さないのか

通知は「起きた出来事の履歴」で、読んだ直後に消えると困る（一覧を見返せない）。
outbox も、配った直後に消すと「二重に配ろうとしていないか」を調べる手がかりが
無くなる。どちらも急いで消す必要は無く、たまった分を定期的にまとめて片付ければよい。

## 作り

cleanup_refresh_tokens と同じ（`BATCH_SIZE` 行ずつ・1 バッチ 1 トランザクション・
`FOR UPDATE SKIP LOCKED`・ロック後に条件を再確認して消す）。

使い方: `python -m app.jobs.cleanup_notifications`
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.logging_config import configure_logging

logger = logging.getLogger(__name__)

BATCH_SIZE = 500


def _delete_in_batches(
    session: Session, table: str, condition: str, cutoff: datetime, batch_size: int
) -> int:
    """`condition` を満たす行を `batch_size` 行ずつ消す。消した行数を返す。"""
    total = 0
    while True:
        ids = [
            row[0]
            for row in session.execute(
                text(
                    f"SELECT id FROM {table} WHERE {condition}"
                    " ORDER BY id LIMIT :n FOR UPDATE SKIP LOCKED"
                ),
                {"cutoff": cutoff, "n": batch_size},
            ).all()
        ]
        if not ids:
            session.commit()
            break
        deleted = session.execute(
            text(f"DELETE FROM {table} WHERE id = ANY(:ids) AND {condition} RETURNING id"),
            {"ids": ids, "cutoff": cutoff},
        ).all()
        session.commit()
        total += len(deleted)
        if len(ids) < batch_size:
            break
    return total


def cleanup_notifications(
    session: Session, *, now: datetime | None = None, batch_size: int = BATCH_SIZE
) -> tuple[int, int]:
    """`(消した通知の数, 消した outbox 行の数)` を返す。バッチごとにコミットする。

    **`session` は新しく開いたものを渡すこと**（CLI の `main()` とテスト専用）。
    バッチごとに中でコミットするので、呼び出し側に未コミットの変更があると
    それも一緒に確定してしまう。"""
    current = now or datetime.now(UTC)
    notification_cutoff = current - timedelta(days=settings.NOTIFICATION_READ_RETENTION_DAYS)
    outbox_cutoff = current - timedelta(days=settings.OUTBOX_PROCESSED_RETENTION_DAYS)

    notifications = _delete_in_batches(
        session,
        "notifications",
        # 既読（read_at あり）で、既読になってから保持期間を過ぎたものだけ。
        "read_at IS NOT NULL AND read_at <= :cutoff",
        notification_cutoff,
        batch_size,
    )
    outbox = _delete_in_batches(
        session,
        "notification_outbox",
        # 配り終えた（processed_at あり）もので、保持期間を過ぎたものだけ。
        "processed_at IS NOT NULL AND processed_at <= :cutoff",
        outbox_cutoff,
        batch_size,
    )
    return notifications, outbox


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    with Session(engine) as session:
        notifications, outbox = cleanup_notifications(session)
    logger.info(
        "通知の掃除完了: 既読通知 %d 件・処理済み outbox %d 件を削除しました",
        notifications,
        outbox,
    )


if __name__ == "__main__":
    main()
