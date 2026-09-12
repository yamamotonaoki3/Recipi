"""通知 outbox の定期スイープ（processing-model.md §8・§9）。

## なぜ要るか

新着レシピ通知は、レシピ投稿のコミット後に FastAPI の `BackgroundTasks` が配る。
`BackgroundTasks` はプロセスのメモリ上にある「後でやる予定」にすぎないので、
配る前にサーバーが再起動・クラッシュすると消えてしまう。

ただし「配る予定」そのものは outbox 表（`notification_outbox`）に残っている。
このスイープは「作られてから 5 分以上たっても未処理の行」を拾い直して配る。
5 分待つのは、今まさに `BackgroundTasks` が配っている最中の行と取り合わないため
（取り合っても `SKIP LOCKED` で片方が飛ばすので壊れはしない）。

※ 5 分は「未処理とみなすまでの経過時間」。このコマンドを**何分おきに動かすか**
  （cron / スケジューラの設定）は、本番のデプロイ先が決まってから別の Issue で決める。

## gc_uploads との違い

gc_uploads は候補を 1 トランザクションでまとめて処理し、コミットを呼び出し側に
任せている。こちらは **1 件ずつ別のトランザクション**にする:

- 1 件の失敗（デッドロック等）で、他の行の配布まで巻き戻したくない
- ロックの順番（users → recipes → outbox）を守るため。候補をまとめて outbox から
  先にロックすると、レシピ削除（recipes → outbox）と逆順になりデッドロックしうる
  （app/services/notification.py `deliver_one`）

使い方: `python -m app.jobs.notification_sweep`
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, col, select

from app.config import settings
from app.db import engine
from app.logging_config import configure_logging
from app.models.notification_outbox import NotificationOutbox
from app.services.notification import deliver_one

logger = logging.getLogger(__name__)

# 作られてからこれ以上たっても未処理の行を「取りこぼし」とみなす（todo.md #18）。
SWEEP_DELAY = timedelta(minutes=5)

# 1 回の実行で見る上限。
BATCH_SIZE = 500


def sweep_outbox(*, now: datetime | None = None) -> int:
    """取りこぼした配布予定を配り直し、処理済みにした outbox の件数を返す。"""
    current = now or datetime.now(UTC)
    deadline = current - SWEEP_DELAY

    # 候補はロックなしで集める（ロックは 1 件ずつ `deliver_one` の中で正しい順に取る）。
    with Session(engine) as session:
        candidate_ids = list(
            session.exec(
                select(NotificationOutbox.id)
                .where(
                    col(NotificationOutbox.processed_at).is_(None),
                    NotificationOutbox.created_at <= deadline,
                )
                .order_by(col(NotificationOutbox.created_at))
                .limit(BATCH_SIZE)
            ).all()
        )

    processed = 0
    for outbox_id in candidate_ids:
        with Session(engine) as session:
            try:
                if deliver_one(session, outbox_id):
                    processed += 1
                session.commit()
            except Exception:
                # この 1 件だけ巻き戻して次へ。行は未処理のまま残り、次回また拾われる。
                session.rollback()
                logger.exception("通知 outbox %s の配布に失敗しました", outbox_id)
    return processed


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    processed = sweep_outbox()
    logger.info("通知 outbox スイープ完了: %d 件を処理しました", processed)


if __name__ == "__main__":
    main()
