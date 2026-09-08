"""一時アップロード GC（processing-model.md §8「一時アップロード GC」）。

## 何を回収するか

1. **期限切れの `pending`**: `POST /images` の途中（オブジェクトの PUT）で
   失敗した残骸。オブジェクトが実在するかは分からないが、削除キューに積んで
   おけば削除ジョブが「あれば消す / 無ければ成功扱い」で処理してくれる。
2. **猶予を過ぎた `stored`**: アップロードはできたが、結局どのレシピにも
   紐付けられなかった画像（ユーザーが編集を中断した等）。

`consumed`（本参照済み）は対象外。

## 競合への備え

GC が動いている最中に、同じ行をレシピ保存が `consumed` にしようとする
かもしれない。そこで:

- `FOR UPDATE SKIP LOCKED` で行を確保する。他が既にロックしていれば
  スキップして先へ進む（待たない ＝ ジョブ全体が止まらない）
- **ロックを取ってから状態をもう一度確認する**。ロック待ちの間に
  `consumed` になっていたら対象外にする

「キーを削除キューに INSERT」と「`uploads` 行を DELETE」は同じ
トランザクションで行う。片方だけ成功すると、消し忘れか二重管理になる。

使い方: `python -m app.jobs.gc_uploads`
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, or_, select

from app.config import settings
from app.db import engine
from app.logging_config import configure_logging
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload

logger = logging.getLogger(__name__)

# 1 回の実行で処理する上限。多すぎるとトランザクションが長くなるので区切る。
BATCH_SIZE = 500


def collect_garbage(session: Session, *, now: datetime | None = None) -> int:
    """回収対象を処理し、削除キューに積んだ件数を返す。

    呼び出し側で `session.commit()` すること（テストから件数を検証しやすい
    ように、コミットはこの関数の外に出している）。
    """
    current = now or datetime.now(UTC)
    stored_deadline = current - timedelta(seconds=settings.UPLOAD_STORED_TTL_SECONDS)

    # 対象: 期限切れの pending、または「作成から猶予を過ぎた」stored。
    # `SKIP LOCKED` は「他がロック中の行は飛ばす」指定（待ち行列を作らない）。
    candidates = session.exec(
        select(Upload)
        .where(
            or_(
                (Upload.status == "pending") & (Upload.expires_at <= current),
                (Upload.status == "stored") & (Upload.created_at <= stored_deadline),
            )
        )
        .limit(BATCH_SIZE)
        .with_for_update(skip_locked=True)
    ).all()

    collected = 0
    for upload in candidates:
        # ロックを取ってから再確認する。ロック待ちの間にレシピ保存が
        # `consumed` にしていたら、それは使用中なので触らない。
        if upload.status == "consumed":
            continue

        session.add(
            PendingStorageDeletion(
                key=upload.key,
                reason=f"upload_gc_{upload.status}",
            )
        )
        session.delete(upload)
        collected += 1

    return collected


def main() -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
    with Session(engine) as session:
        collected = collect_garbage(session)
        session.commit()
    logger.info("一時アップロード GC 完了: %d 件を削除キューに積みました", collected)


if __name__ == "__main__":
    main()
