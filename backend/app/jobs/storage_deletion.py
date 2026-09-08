"""ストレージ削除ジョブ（processing-model.md §8「ストレージ削除ジョブ」）。

削除キュー（`pending_storage_deletions`）に積まれたオブジェクトキーを、
実際に S3 / MinIO から消す。

## 冪等性

- 同じキーが重複して積まれていても構わない。`storage.delete_object` は
  「既に存在しない」を成功として扱う
- 失敗したら行を消さずに `attempts` を増やして次回に回す。上限を超えたものは
  `last_error` を残したまま残置し、運用で調査できるようにする（無限に
  再試行してジョブが詰まるのを防ぐ）

## トランザクションの持ち方

外部 I/O（S3 の DELETE）を挟むので、1 件ごとに短く区切ってコミットする。
まとめて 1 トランザクションにすると、途中で落ちたときに「消したのに
キューに残っている」件数が増えてしまう（消し済みの再実行は無害だが、
長いトランザクションはロックを持ち続けるので避ける）。

使い方: `python -m app.jobs.storage_deletion`
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, update
from sqlmodel import Session, select

from app import storage
from app.config import settings
from app.db import engine
from app.logging_config import configure_logging
from app.models.pending_storage_deletion import PendingStorageDeletion

logger = logging.getLogger(__name__)

# 1 回の実行で処理する上限。
BATCH_SIZE = 500

# これを超えて失敗し続けた行は再試行しない（調査用に残す）。
MAX_ATTEMPTS = 5


def process_queue(session: Session, *, limit: int = BATCH_SIZE) -> tuple[int, int]:
    """キューを消化し、`(成功件数, 失敗件数)` を返す。

    1 件ごとにコミットするので、呼び出し側での commit は不要。
    """
    # バッチ取得後に各件を commit するため、行ロックを使っても 1 件目の commit で
    # 残りのロックまで解放される。外部ストレージへの I/O 中にロックを持ち続けるより、
    # 同じ行を複数ワーカーが取得しても安全な冪等性で並行実行に耐える方がよい。
    # そのため ORM 行ではなく、必要な id と key だけを素の値として控える。
    queue_items = [
        (row_id, key)
        for row_id, key in session.exec(
            select(PendingStorageDeletion.id, PendingStorageDeletion.key)
            .where(PendingStorageDeletion.attempts < MAX_ATTEMPTS)
            .order_by(
                PendingStorageDeletion.attempts,  # type: ignore[arg-type]
                PendingStorageDeletion.enqueued_at,  # type: ignore[arg-type]
            )
            .limit(limit)
        ).all()
    ]

    succeeded = 0
    failed = 0
    for row_id, key in queue_items:
        try:
            storage.delete_object(key)
        except Exception as exc:  # noqa: BLE001  失敗理由を問わず次回に回す
            # 例外メッセージは調査用。長すぎると DB を圧迫するので切り詰める。
            error_message = str(exc)[:500]
            session.exec(
                update(PendingStorageDeletion)
                .where(PendingStorageDeletion.id == row_id)  # type: ignore[arg-type]
                .values(
                    attempts=PendingStorageDeletion.attempts + 1,
                    last_error=error_message,
                )
            )
            session.commit()
            failed += 1
            logger.warning("オブジェクトの削除に失敗しました key=%s", key)
            continue

        # 先に別ワーカーが同じ行を削除していても、DELETE 0 件は成功扱いにする。
        # ストレージ削除自体も「既に無い」を成功にするため、重複キューを安全に消化できる。
        session.exec(
            delete(PendingStorageDeletion).where(PendingStorageDeletion.id == row_id)  # type: ignore[arg-type]
        )
        session.commit()
        succeeded += 1

    return succeeded, failed


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    with Session(engine) as session:
        succeeded, failed = process_queue(session)
    logger.info("ストレージ削除ジョブ完了: 成功 %d 件 / 失敗 %d 件", succeeded, failed)


if __name__ == "__main__":
    main()
