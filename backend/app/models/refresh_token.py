"""`refresh_tokens` テーブルに対応するモデル。

リフレッシュトークンは「ローテーション方式」で運用する:
- ログイン/サインアップ時に 1 本発行される。
- `/auth/refresh` を叩くたびに、古いトークンを失効させて新しいトークンを
  発行する（使い捨て）。
- 同じ `chain_id` を持つトークン群が「1 つのログインセッションの履歴」を表す。
  すでに失効した（＝使用済みの）トークンが再提示された場合は、盗用された
  可能性があるとみなして `chain_id` が同じトークンを全部失効させる
  （reuse 検知。features/auth.md 参照）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RefreshToken(SQLModel, table=True):
    __tablename__ = "refresh_tokens"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
    )

    # 生のリフレッシュトークン文字列は絶対に保存しない。DB が漏れても
    # トークンを復元できないよう、ハッシュ値（SHA-256）だけを保存する
    # （security.py の hash_refresh_token を参照）。
    token_hash: str = Field(unique=True, nullable=False)

    # ローテーションの連鎖を識別する ID（同じログインセッション由来の
    # トークンはすべて同じ chain_id を持つ）。
    chain_id: uuid.UUID = Field(nullable=False, index=True)

    expires_at: datetime = Field(nullable=False)

    # 失効した日時。null なら「まだ有効」。ローテーションで使い捨てられた
    # とき／ログアウトしたとき／reuse 検知でチェーン全体を失効させたときに
    # ここに現在時刻を入れる。
    revoked_at: datetime | None = Field(default=None, nullable=True)

    # ログイン時の「ログインを保持」チェックの値
    # （processing-model.md §6: 「login: refresh_tokens INSERT（rememberMe
    # で有効期限を調整）」）。ローテーション（/auth/refresh）のたびに
    # 新しいトークンへこの値を引き継ぐことで、チェーン全体で同じ有効期限
    # 方針（長期 or 短期）を保つ。signup 時は常に True（サインアップ直後は
    # 続けてログイン状態になるのが自然なため）。
    remember_me: bool = Field(default=True, nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
