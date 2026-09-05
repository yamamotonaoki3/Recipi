"""`users` テーブルに対応するモデル。

Phase 1（認証）で必要な列だけをここで定義する。プロフィール機能
（アバター・SNS リンク等）は Phase 2 以降の Issue で列を追加していく
（同じ `users` テーブルに列を足す想定。data-model.md 参照）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """タイムゾーン付き（UTC）の現在時刻。DB には常に UTC で保存する。"""
    return datetime.now(UTC)


class User(SQLModel, table=True):
    __tablename__ = "users"

    # UUID は Postgres の拡張（pgcrypto 等）に頼らず、Python 側
    # （uuid4）で発行する。DB 拡張が入っていない環境でもそのまま動く。
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    email: str = Field(unique=True, index=True, nullable=False)

    # パスワードそのものではなく Argon2id でハッシュ化した文字列を保存する
    # （app/security.py の hash_password / verify_password を参照）。
    password_hash: str = Field(nullable=False)

    # 表示名。1〜30 文字の制約は API 層（Pydantic スキーマ）で担保する。
    display_name: str = Field(nullable=False)

    # パスワードを忘れた場合に使う「秘密の質問」と、その答えのハッシュ。
    # 答えは正規化（trim + casefold）してから Argon2id でハッシュ化する
    # （security.py の normalize_security_answer を参照）。
    security_question: str = Field(nullable=False)
    security_answer_hash: str = Field(nullable=False)

    # アクセストークンの「世代」。パスワードリセット等でこの値をインクリメント
    # すると、それより前に発行済みのアクセストークンは（有効期限内でも）
    # 全て無効になる（dependencies.py の get_current_user がここを照合する）。
    token_version: int = Field(default=0, nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=_utcnow, nullable=False)
