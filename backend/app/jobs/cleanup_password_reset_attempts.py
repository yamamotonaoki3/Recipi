"""パスワード再設定の試行記録（`password_reset_attempts`）の掃除（Issue #85）。

## 何を消すか

作られてから **1 日**（`PASSWORD_RESET_ATTEMPT_RETENTION_DAYS`）を過ぎた記録。境界は
`<=`（ちょうど 1 日たった行も消す。ほかの掃除ジョブと同じ）。

記録は再設定の `request`（**成功した呼び出しも含む**）と `confirm` の失敗のたびに 1 行
作られ、メールアドレスと IP アドレスという個人情報を含む（app/api/auth.py）。users への
外部キーが無いので、アカウントを削除しても消えない。放っておくと期限なく残り続ける。

## なぜ 1 日か

レート制限（app/api/auth.py の `_count_recent_attempts`）が数えるのは**直近 15 分**の
記録だけ。1 日あれば判定に必要な記録は必ず残り、個人情報を必要以上に持たない。
設定は 1 以上に制限しているので、15 分より短くなって判定を壊すことは起きない。

## 作り

ほかの掃除ジョブと同じ（`app/jobs/_batch.py` の `delete_in_batches`: `BATCH_SIZE` 行ずつ・
1 バッチ 1 トランザクション・`FOR UPDATE SKIP LOCKED`・ロック後に条件を再確認して消す）。

使い方: `python -m app.jobs.cleanup_password_reset_attempts`
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.jobs._batch import delete_in_batches
from app.logging_config import configure_logging

logger = logging.getLogger(__name__)

BATCH_SIZE = 500


def cleanup_password_reset_attempts(
    session: Session, *, now: datetime | None = None, batch_size: int = BATCH_SIZE
) -> int:
    """保持期間を過ぎた試行記録を消し、消した件数を返す。バッチごとにコミットする。

    **`session` は新しく開いたものを渡すこと**（CLI の `main()` とテスト専用）。
    バッチごとに中でコミットするので、呼び出し側に未コミットの変更があると
    それも一緒に確定してしまう。"""
    current = now or datetime.now(UTC)
    cutoff = current - timedelta(days=settings.PASSWORD_RESET_ATTEMPT_RETENTION_DAYS)
    return delete_in_batches(
        session,
        "password_reset_attempts",
        # 作られてから保持期間を過ぎたものだけ（直近 15 分のレート制限の判定には影響しない）。
        "created_at <= :cutoff",
        cutoff,
        batch_size,
    )


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    with Session(engine) as session:
        deleted = cleanup_password_reset_attempts(session)
    logger.info("パスワード再設定の試行記録の掃除完了: %d 件を削除しました", deleted)


if __name__ == "__main__":
    main()
