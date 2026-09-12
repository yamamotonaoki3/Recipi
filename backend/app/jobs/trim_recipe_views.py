"""閲覧履歴の件数上限（processing-model.md §8。features/view-history.md。Issue #72）。

1 ユーザーあたり `RECIPE_VIEWS_MAX_PER_USER`（既定 200）件を超えた閲覧履歴を、
古い順に消す。上限内のユーザーには何もしない。

## なぜ閲覧のたびに削らないのか

閲覧の記録（`POST /recipes/{id}/view`）はレシピを開くたびに呼ばれる。そこで毎回
「件数を数えて超えた分を消す」をすると、よく使う操作が重くなる。履歴が一時的に
上限を少し超えていても困らないので、定期的にまとめて削る（todo.md #9d の「定期ジョブ方式」）。

## 並行処理の考え方

- **同じユーザーを 2 本のジョブが同時に削らない**: 行単位のロックだけだと、2 本が
  同じユーザーの別々の古い行を取り、両方消して上限を下回ることがある。そこで
  ユーザーごとに `pg_try_advisory_xact_lock`（DB が用意している「名前付きの鍵」）を取り、
  取れなければそのユーザーは今回は飛ばす（待たない。次回の実行で拾われる）
- **削っている最中の閲覧で、今見たばかりの行を消さない**: 閲覧の記録は鍵を取らないので、
  2 段にする。① 残す行のうち一番古いもの（新しい順で上限件目）を「境界」として読む
  ② 境界より古い行だけを消す。消そうとした行がちょうど閲覧で新しくなってコミット
  されると、PostgreSQL はロック待ちの後で**更新後の行に条件を当て直す**ので、
  境界より新しくなった行は消えない（多めに残るだけで、次回また削る）

1 トランザクションで消すのは最大 `BATCH_SIZE` 行。1 人に大量の超過がたまっていても、
境界を読み直しながら繰り返して、長いトランザクションにしない。

使い方: `python -m app.jobs.trim_recipe_views`
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.logging_config import configure_logging

logger = logging.getLogger(__name__)

# 1 トランザクションで消す行数の上限・1 回に列挙するユーザー数。
BATCH_SIZE = 500


def _trim_one_user(session: Session, user_id: uuid.UUID, max_views: int, batch_size: int) -> int:
    """1 ユーザー分を上限まで削る。消した行数を返す（他のジョブが処理中なら 0）。"""
    total = 0
    while True:
        got_lock = session.execute(
            text("SELECT pg_try_advisory_xact_lock(hashtext('trim_recipe_views:' || :u))"),
            {"u": str(user_id)},
        ).scalar_one()
        if not got_lock:
            # 同じユーザーを別のジョブが削っている最中。今回は飛ばす。
            session.rollback()
            return total

        # ① 境界 = 残す行のうち一番古いもの（新しい順で max_views 件目）。
        boundary = session.execute(
            text(
                "SELECT viewed_at, recipe_id FROM recipe_views WHERE user_id = :u"
                " ORDER BY viewed_at DESC, recipe_id DESC OFFSET :k LIMIT 1"
            ),
            {"u": user_id, "k": max_views - 1},
        ).first()
        if boundary is None:
            session.commit()
            return total

        # ② 境界より古い行を、古い順に最大 batch_size 行だけ消す。外側の条件は、
        # 行が閲覧で新しくなっていたら当て直しで外れる（上のコメント参照）。
        deleted = session.execute(
            text(
                """
                DELETE FROM recipe_views
                 WHERE (user_id, recipe_id) IN (
                        SELECT user_id, recipe_id FROM recipe_views
                         WHERE user_id = :u AND (viewed_at, recipe_id) < (:bv, :br)
                         ORDER BY viewed_at, recipe_id
                         LIMIT :n)
                   AND user_id = :u
                   AND (viewed_at, recipe_id) < (:bv, :br)
                RETURNING recipe_id
                """
            ),
            {"u": user_id, "bv": boundary[0], "br": boundary[1], "n": batch_size},
        ).all()
        session.commit()
        total += len(deleted)
        if len(deleted) < batch_size:
            return total


def trim_recipe_views(session: Session, *, batch_size: int = BATCH_SIZE) -> int:
    """上限を超えたユーザーの古い閲覧履歴を消し、消した行数を返す。

    **`session` は新しく開いたものを渡すこと**（CLI の `main()` とテスト専用）。
    バッチごとに中でコミットするので、呼び出し側に未コミットの変更があると
    それも一緒に確定してしまう。"""
    max_views = settings.RECIPE_VIEWS_MAX_PER_USER
    total = 0
    after: uuid.UUID | None = None
    while True:
        # 上限を超えているユーザーを user_id 順に batch_size 人ずつ（前回の続きから）。
        users = [
            row[0]
            for row in session.execute(
                text(
                    "SELECT user_id FROM recipe_views"
                    " WHERE (CAST(:after AS uuid) IS NULL OR user_id > CAST(:after AS uuid))"
                    " GROUP BY user_id HAVING count(*) > :max"
                    " ORDER BY user_id LIMIT :n"
                ),
                {"after": str(after) if after else None, "max": max_views, "n": batch_size},
            ).all()
        ]
        session.commit()
        if not users:
            break
        for user_id in users:
            total += _trim_one_user(session, user_id, max_views, batch_size)
        after = users[-1]
        if len(users) < batch_size:
            break
    return total


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    with Session(engine) as session:
        deleted = trim_recipe_views(session)
    logger.info("閲覧履歴の上限処理完了: %d 件を削除しました", deleted)


if __name__ == "__main__":
    main()
