"""`/auth/*` エンドポイントのリクエスト/レスポンススキーマ。"""

from __future__ import annotations

import uuid

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import CamelModel

# パスワードの最小/最大文字数は features/auth.md で「仮でよい・todo #16」と
# されている暫定値。8 文字未満は弱すぎる、72 文字は Argon2 の実務上の
# 一般的な上限（それ以上は切り詰められる実装があるため）。
# password-reset/confirm の new_password はこの定数を使って
# app/api/auth.py 側で手動チェックするため、モジュール外から使えるように
# アンダースコア無しで公開する。
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 72


def _reject_blank_security_answer(value: str) -> str:
    """正規化（前後空白除去）すると空になる回答（空白だけの入力など）を拒否する。

    `min_length=1` だけだと " "（半角スペース1文字）のような入力を通してしまい、
    `hash_security_answer()` 側で trim すると実質空文字になる。空文字が
    「秘密の質問の回答」として登録できてしまうと、パスワードリセットの
    本人確認が誰でも突破できる意味のないものになるため、ここで弾く。
    """
    if not value.strip():
        raise ValueError("秘密の質問の回答は空白のみにできません")
    return value


def _normalize_email(value: object) -> object:
    """メールアドレスを前後の空白除去 + 小文字化して正規化する。

    `User@example.com` と `user@example.com` を別人として登録できて
    しまうと、大文字/小文字の打ち間違いだけでログインやパスワードリセットが
    できなくなる。DB の UNIQUE 制約は大文字小文字を区別するため、
    保存前・検索前にこの関数で必ず正規化する。

    `mode="before"` なので、`{"email": null}` のような文字列以外の値が
    そのまま渡ってくることがある。ここで `.strip()` して `AttributeError`
    を起こすと `RequestValidationError` を素通りして 500 になってしまうため、
    文字列以外はそのまま返し、型チェック自体は後段の `EmailStr` に任せる。
    """
    if not isinstance(value, str):
        return value
    return value.strip().lower()


class SignupRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    display_name: str = Field(min_length=1, max_length=30)
    security_question: str = Field(min_length=1, max_length=120)
    security_answer: str = Field(min_length=1, max_length=100)

    _normalize_email = field_validator("email", mode="before")(_normalize_email)
    _reject_blank_security_answer = field_validator("security_answer")(
        _reject_blank_security_answer
    )


class LoginRequest(CamelModel):
    email: EmailStr
    # ログイン失敗時は verify_password（Argon2）に渡すだけで DB には保存しない
    # 値だが、上限が無いと巨大な文字列を Argon2 に処理させて CPU/メモリを
    # 浪費させられる（実在するパスワードは signup 時点で 72 文字までしか
    # 登録できないため、それより長い入力は最初から一致し得ない）。
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)
    remember_me: bool = False

    _normalize_email = field_validator("email", mode="before")(_normalize_email)


class RefreshRequest(CamelModel):
    refresh_token: str


class LogoutRequest(CamelModel):
    refresh_token: str


class PasswordResetRequestRequest(CamelModel):
    email: EmailStr

    _normalize_email = field_validator("email", mode="before")(_normalize_email)


class PasswordResetRequestResponse(CamelModel):
    security_question: str


class PasswordResetConfirmRequest(CamelModel):
    email: EmailStr
    security_answer: str = Field(min_length=1, max_length=100)
    # newPassword の文字数チェックは、あえて Pydantic の Field 制約にしない。
    # ここで制約すると Pydantic レベルで弾かれてしまい、api.md/auth.md が
    # 求める「未登録メール・答え不一致・新パスワード不正のすべてを同じ
    # 400（理由を区別しない）」という契約が崩れる（Pydantic の
    # ValidationError は専用のエラー詳細を返すため、他の 2 ケースと見分けが
    # ついてしまう）。そのため文字数チェックは
    # app/api/auth.py の password_reset_confirm 内で他の失敗ケースと
    # 同じ分岐にまとめて行う。
    new_password: str

    # security_answer に空白のみを弾くバリデータをあえて付けない:
    # ここで Pydantic レベルの ValueError にすると、「メールが見つからない」
    # 「回答が違う」とは別のエラー形式になり、失敗理由が見分けられてしまう
    # （new_password と同じ理由。上のコメント参照）。空白だけの回答は、
    # どのみち正規化後のハッシュと一致しないため、password_reset_confirm
    # 内の通常の「回答不一致」判定に自然に落ちる。
    _normalize_email = field_validator("email", mode="before")(_normalize_email)


class UserPublic(CamelModel):
    id: uuid.UUID
    display_name: str


class AuthTokenResponse(CamelModel):
    user: UserPublic
    access_token: str
    refresh_token: str


class RefreshResponse(CamelModel):
    # features/auth.md の契約どおり、/auth/refresh は user を含まない。
    access_token: str
    refresh_token: str
