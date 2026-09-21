"""`reauth_attempts` テーブルに対応するモデル（Issue #240）。

「現在のパスワードで再認証してから認証情報を変更する」操作のレート制限に使う。
対象は秘密の質問・答えの変更（#240）と、メールアドレスの変更（#241）。

## なぜ必要か

Argon2id はわざと遅いので「総当たりしにくい」が、**遅いこと自体が CPU を
消費させる攻撃経路**にもなる。また、アクセストークンを盗んだ攻撃者が
このエンドポイントでパスワードを総当たりすることも防ぎたい。
Argon2 の検証を走らせる**前**に、直近の試行回数で頭打ちにする。

## なぜ `password_reset_attempts` を流用しないか

同じテーブルを使うと、秘密の質問を何度か変えただけでパスワードリセットまで
ロックされてしまう。困りごとが別なので、テーブルも分ける。

## 操作の種類を列に持たない理由

守りたい資源は「現パスワードの Argon2 検証」であり、#240 と #241 で同じもの。
種類ごとに枠を分けると、攻撃者は操作を交互に呼ぶだけで枠を 2 倍使えてしまう。
そのため**両方で 1 つの枠を共有**する。

## 保持期間

レート制限が数えるのは直近 15 分だけなので、`REAUTH_ATTEMPT_RETENTION_DAYS`
（既定 1 日）を過ぎた行は掃除ジョブ（`app/jobs/cleanup_reauth_attempts.py`）が消す。
IP アドレスという個人情報を必要以上に持たないため。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from app.models._types import UTC_DATETIME


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ReauthAttempt(SQLModel, table=True):
    __tablename__ = "reauth_attempts"

    # 索引は `Field(index=True)` の単独索引ではなく複合索引にする。レート制限は
    # 「直近 15 分の user_id 単位 / ip_address 単位の件数」を数えるので、絞り込む列と
    # 期間の列をまとめた索引でないと効かない。掃除ジョブは created_at だけで探すため、
    # 単独の索引も別に張る（alembic d2e3f4a5b6c7 と同じ定義にそろえてある）。
    __table_args__ = (
        Index("ix_reauth_attempts_user_created", "user_id", "created_at"),
        Index("ix_reauth_attempts_ip_created", "ip_address", "created_at"),
        Index("ix_reauth_attempts_created_at", "created_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 再認証を試みた本人。`password_reset_attempts` と違い対象ユーザーが
    # 確定しているので、外部キーを張れる（退会は論理削除なので実際には
    # 消えないが、将来アカウントを物理削除する経路ができたときに残さない）。
    user_id: uuid.UUID = Field(foreign_key="users.id", ondelete="CASCADE")

    # 呼び出し元の IP。ユーザー単位だけを見ると、攻撃者が多数のアカウントに
    # 1 回ずつ試行すれば閾値に達しないまま大量の Argon2 検証を走らせられる。
    # IP 単位でも別途数えることで、同一クライアントからの総試行数を頭打ちにする。
    ip_address: str = Field(nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False, sa_type=UTC_DATETIME)
