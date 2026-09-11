"""`pending_storage_deletions` テーブルに対応するモデル（削除キュー）。

## なぜキューを挟むのか

「レシピを削除したので、その画像もストレージから消す」を素直に書くと、
削除 API の中で S3 / MinIO を呼ぶことになる。するとストレージが落ちている
ときにレシピの削除まで失敗してしまう。ユーザーから見れば「消したいだけ
なのに消せない」で、しかも DB 側は消えているのに応答はエラー、という
分かりにくい状態にもなりうる。

そこで **「消すべきキー」を DB のキューに積むところまでを削除処理と
同じトランザクションで行い**、実際のオブジェクト削除は定期ジョブ
（app/jobs/storage_deletion.py）に任せる。コミットされた時点で「あとで
必ず消される」ことが保証され、ストレージ障害は削除 API に波及しない
（processing-model.md §5-2・§8・§9）。

## 冪等性

`key` に UNIQUE を張らない。同じキーが二重に積まれても、削除ジョブ側が
「既に存在しない」を成功として扱うので害が無い。逆に UNIQUE にすると、
二重登録のたびにトランザクションが落ちて本体の処理を巻き込んでしまう。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class PendingStorageDeletion(SQLModel, table=True):
    __tablename__ = "pending_storage_deletions"
    __table_args__ = (
        sa.CheckConstraint("attempts >= 0", name="ck_pending_deletions_attempts_non_negative"),
        # 削除ジョブが「試行回数が少ないものから古い順に」取り出すための索引。
        sa.Index("ix_pending_deletions_attempts_enqueued_at", "attempts", "enqueued_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 消すべきオブジェクトキー。重複を許容する（上のコメント参照）。
    key: str = Field(nullable=False, index=True)

    # 何が原因で消すことになったか（調査用。例: "recipe_deleted"）。
    reason: str = Field(nullable=False)

    enqueued_at: datetime = Field(default_factory=_utcnow, nullable=False)

    # 削除ジョブが失敗するたびに +1。上限を超えたものは調査対象として残す。
    attempts: int = Field(default=0, nullable=False)

    # この時刻を過ぎるまで削除ジョブは消さない。NULL は「すぐ消してよい」。
    # アカウント削除で、アップロード途中（pending）のキーを積むときにだけ使う
    # （PUT がまだ終わっていないかもしれないので、pending の期限を過ぎてから消す。Issue #71）。
    delete_after: datetime | None = Field(default=None, nullable=True)
    last_error: str | None = Field(default=None, nullable=True)
