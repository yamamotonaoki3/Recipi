"""`users` テーブルに対応するモデル。

Phase 1（認証）で必要な列だけをここで定義する。プロフィール機能
（アバター・SNS リンク等）は Phase 2 以降の Issue で列を追加していく
（同じ `users` テーブルに列を足す想定。data-model.md 参照）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """タイムゾーン付き（UTC）の現在時刻。DB には常に UTC で保存する。"""
    return datetime.now(UTC)


class User(SQLModel, table=True):
    __tablename__ = "users"
    __table_args__ = (
        # カウント列は減算もするので、バグで負の数になったら DB で気付けるようにする
        # （data-model.md「DB レベルの制約が正」／ recipes の favorite_count と同じ方針）。
        sa.CheckConstraint("following_count >= 0", name="ck_users_following_count_non_negative"),
        sa.CheckConstraint("follower_count >= 0", name="ck_users_follower_count_non_negative"),
    )

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

    # 非正規化カウント（カウント列キャッシュ。non-functional.md）。
    # - following_count … この人が「フォローしている」人数
    # - follower_count  … この人を「フォローしている」人数
    # 一覧やプロフィールを開くたびに `COUNT(*)` すると重いので、`follows` の
    # INSERT / DELETE と**同一トランザクション**で ±1 する（app/services/follow.py）。
    # ズレたときの保険として、実数から数え直す補正ジョブを別に持つ
    # （app/jobs/recount_counts.py。processing-model.md §8「多層防御」）。
    following_count: int = Field(default=0, nullable=False)
    follower_count: int = Field(default=0, nullable=False)

    # --- プロフィール（Issue #67・features/profile.md §4） -------------------
    #
    # アバター画像のオブジェクトキー。無ければ None（クライアントはプレースホルダを出す）。
    # 表示用 URL はキーから組み立てる派生値なので DB には持たない（image.md §4）。
    avatar_key: str | None = Field(default=None, nullable=True)

    # 連絡先・SNS と、それぞれを「他の人に公開するか」のトグル。
    # **既定はすべて非公開（False）**。公開 OFF の項目は、他人がプロフィールを
    # 取得したときのレスポンスにキーごと含めない（non-functional.md「データの
    # 可視性ルール」。組み立ては app/services/user.py）。本人にだけ全項目を返す。
    email_public: bool = Field(default=False, nullable=False)
    x_url: str | None = Field(default=None, max_length=2048, nullable=True)
    x_public: bool = Field(default=False, nullable=False)
    instagram_url: str | None = Field(default=None, max_length=2048, nullable=True)
    instagram_public: bool = Field(default=False, nullable=False)
    other_url: str | None = Field(default=None, max_length=2048, nullable=True)
    other_public: bool = Field(default=False, nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=_utcnow, nullable=False)
