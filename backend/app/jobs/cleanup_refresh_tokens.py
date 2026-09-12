"""期限切れリフレッシュトークンの掃除（processing-model.md §8。Issue #72）。

## なぜ即時に消さないのか

リフレッシュトークンは「使うたびに古いものを失効させて新しいものを出す」
ローテーション方式で、使い終わった（失効済みの）トークンも行として残している。
失効済みのトークンがもう一度提示されたら「盗まれて使われたかもしれない」とみなし、
同じ `chain_id`（同じログインセッション）のトークンを全部失効させるため
（再利用検知。features/auth.md・app/api/auth.py）。

つまり古い行は「証拠」として役に立つ。すぐに消すと、この検知ができなくなる。

## 何を消すか — チェーン単位で「全部が期限切れから 30 日以上」のものだけ

チェーンの中に 1 つでも「まだ使える（または期限切れから日が浅い）」トークンが
あるうちは、そのチェーンの行は 1 行も消さない。まだ使えるトークンがある間は、
古いトークンの再利用を検知して、生きているトークンを失効させる意味があるから。

チェーンが丸ごと「最後のトークンの期限から 30 日」を過ぎたら、失効させるべき
生きたトークンはもう無い。行が残っていても（再利用検知 → チェーン全体を失効 → 401）、
行が無くても（見つからない → 401）結果は同じなので、消してよい。

期限切れのトークンで `/auth/refresh` しても 401 で新しい行は増えないので、
チェーンを途中まで消した状態になっても、残りも同じ条件を満たしていて安全。

## 作り

1 回の実行で、その時点で取れる対象をすべて消すまで `BATCH_SIZE` 行ずつ繰り返す
（1 バッチ = 1 トランザクション。長いトランザクションにしない）。
`FOR UPDATE SKIP LOCKED` で、`/auth/refresh` などが今ロックしている行は待たずに
飛ばす（次回に回る）。二重に起動しても、同じ行を取り合って待つことはない。

既存の gc_uploads は「1 回 1 バッチ・コミットは呼び出し側」だが、こちらは
対象が多くても 1 回で片付くよう、関数の中でバッチごとにコミットする。

使い方: `python -m app.jobs.cleanup_refresh_tokens`
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

# 1 トランザクションで消す上限。
BATCH_SIZE = 500

# 「同じチェーンに、まだ消してはいけないトークンが 1 つも無い」行。
# NOT EXISTS の中は、同じ chain_id で期限が cutoff より後のトークンを探す
# （見つかったら、そのチェーンはまだ残す）。
#
# 先頭の `t.expires_at <= :cutoff` は結果を変えない（NOT EXISTS を満たす行は必ず
# これも満たす）が、索引で「期限切れの行」だけに候補を絞るために書く。これが無いと、
# まだ使えるトークンが大量にあっても毎回表全体を読んでチェーンを調べることになる。
_ELIGIBLE = """
    t.expires_at <= :cutoff
    AND NOT EXISTS (
        SELECT 1 FROM refresh_tokens other
         WHERE other.chain_id = t.chain_id AND other.expires_at > :cutoff
    )
"""


def cleanup_refresh_tokens(
    session: Session, *, now: datetime | None = None, batch_size: int = BATCH_SIZE
) -> int:
    """消した行数を返す。バッチごとにコミットする。

    **`session` は新しく開いたものを渡すこと**（CLI の `main()` とテスト専用）。
    バッチごとに中でコミットするので、呼び出し側に未コミットの変更があると
    それも一緒に確定してしまう。"""
    cutoff = (now or datetime.now(UTC)) - timedelta(
        days=settings.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS
    )
    total = 0
    while True:
        ids = [
            row[0]
            for row in session.execute(
                text(
                    f"SELECT t.id FROM refresh_tokens t WHERE {_ELIGIBLE}"
                    " ORDER BY t.id LIMIT :n FOR UPDATE SKIP LOCKED"
                ),
                {"cutoff": cutoff, "n": batch_size},
            ).all()
        ]
        if not ids:
            session.commit()
            break
        # ロックを取った後で、条件をもう一度確かめてから消す（都度判定）。
        deleted = session.execute(
            text(
                f"DELETE FROM refresh_tokens t WHERE t.id = ANY(:ids) AND {_ELIGIBLE}"
                " RETURNING t.id"
            ),
            {"ids": ids, "cutoff": cutoff},
        ).all()
        session.commit()
        total += len(deleted)
        if len(ids) < batch_size:
            break
    return total


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    with Session(engine) as session:
        deleted = cleanup_refresh_tokens(session)
    logger.info("期限切れリフレッシュトークンの掃除完了: %d 件を削除しました", deleted)


if __name__ == "__main__":
    main()
