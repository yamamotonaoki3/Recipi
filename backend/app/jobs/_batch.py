"""定期ジョブの共通部品: 条件に合う行を少しずつ消す（Issue #72 で作り、#85 で共通化）。

1 バッチ = 1 トランザクション。`FOR UPDATE SKIP LOCKED` で、他の処理がロック中の行は
飛ばす（今回は消さず、次回の実行で拾う）。ロックした後に条件をもう一度確かめてから
消すので、ロックを取るまでの間に条件から外れた行（例: 未読に戻った通知）は消えない。

**`table` と `condition` はコードの中の固定の文字列だけを渡すこと**。SQL にそのまま
埋め込むので、利用者の入力や外から来た値を入れてはいけない（SQL インジェクションになる）。
境界の時刻は `:cutoff` のパラメータで渡す。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlmodel import Session


def delete_in_batches(
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
