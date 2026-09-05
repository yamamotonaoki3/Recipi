"""パスワードのハッシュ化・JWT の発行/検証・リフレッシュトークンの生成をまとめる。

このファイルは「秘密情報の扱い」に関わるコードを 1 箇所に集約する目的で
分けている。ルーター（app/api/auth.py）はここの関数だけを呼び、
ハッシュアルゴリズムや JWT ライブラリの詳細を意識しなくてよいようにする。
"""

from __future__ import annotations

import hashlib
import secrets
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.config import settings

# --- パスワード / 秘密の質問の回答のハッシュ化 --------------------------------
#
# Argon2id は「パスワードハッシュ用に設計されたハッシュ関数」で、SHA-256 等の
# 汎用ハッシュと違い、わざと時間とメモリを消費するように作られている
# （総当たり攻撃・レインボーテーブル攻撃を遅くするため）。
# `PasswordHasher()` はデフォルトで Argon2id・OWASP 推奨相当のパラメータを使う。
_password_hasher = PasswordHasher()


def hash_password(raw_password: str) -> str:
    """平文パスワードを Argon2id でハッシュ化する。DB にはこの戻り値だけを保存する。"""
    return _password_hasher.hash(raw_password)


def verify_password(raw_password: str, password_hash: str) -> bool:
    """平文パスワードがハッシュと一致するか確認する。"""
    try:
        return _password_hasher.verify(password_hash, raw_password)
    except VerifyMismatchError:
        return False


# メールアドレスが未登録の場合に使うダミーのハッシュ（＝誰のパスワードとも
# 一致しない固定値）。login() が「ユーザーが見つからない」ときにも
# Argon2 の検証を必ず 1 回走らせるために使う。存在するメールアドレス宛の
# 誤ったパスワード（＝ Argon2 検証が実際に走る）と、存在しないメール
# アドレス（＝検証をスキップする）とで応答時間に差が出ると、レスポンスの
# 中身は同じ 401 でも、かかった時間の違いからメールアドレスの登録有無を
# 推測されてしまう（タイミング攻撃）。
_DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing-safety-only")


def verify_password_or_dummy(raw_password: str, password_hash: str | None) -> bool:
    """`password_hash` が無い（＝ユーザーが存在しない）場合もダミーハッシュと
    照合し、常に同じだけの処理時間がかかるようにした `verify_password`。
    戻り値は `password_hash is None` の場合は常に False。
    """
    is_match = verify_password(raw_password, password_hash or _DUMMY_PASSWORD_HASH)
    return is_match if password_hash is not None else False


def normalize_security_answer(raw_answer: str) -> str:
    """秘密の質問の回答を正規化する。

    - 前後の空白を除去
    - 大文字小文字を無視（casefold）
    - NFKC 正規化で全角/半角・互換文字の表記ゆれを統一
      （例: "ﾗｰﾒﾝ"（半角カナ）と "ラーメン"（全角カナ）を同じ扱いにする）

    これでも吸収しきれない表記ゆれ（同義語・ひらがな/カタカナ違いなど）は
    残るが、それ以上の厳密な一致判定は行わない（暫定仕様。todo #16）。
    """
    return unicodedata.normalize("NFKC", raw_answer.strip()).casefold()


def hash_security_answer(raw_answer: str) -> str:
    """正規化した秘密の質問の回答を Argon2id でハッシュ化する。"""
    return _password_hasher.hash(normalize_security_answer(raw_answer))


def verify_security_answer(raw_answer: str, answer_hash: str) -> bool:
    """秘密の質問の回答（正規化前の生入力）がハッシュと一致するか確認する。"""
    return verify_password(normalize_security_answer(raw_answer), answer_hash)


# --- アクセストークン（JWT） --------------------------------------------------


class AccessTokenPayload(TypedDict):
    """デコードしたアクセストークンの中身。"""

    sub: str
    token_version: int


class InvalidAccessTokenError(Exception):
    """アクセストークンが無効（署名不正・期限切れ・形式不正）なときの例外。

    PyJWT が投げる例外（ExpiredSignatureError, InvalidTokenError など）を
    このアプリ共通の例外に変換することで、呼び出し側（dependencies.py）が
    PyJWT の詳細を知らなくても「401 にすればよい」と判断できるようにする。
    """


def create_access_token(user_id: uuid.UUID, token_version: int) -> str:
    """アクセストークン（JWT）を発行する。

    JWT は「ヘッダー.ペイロード.署名」の 3 つを "." でつないだ文字列。
    ペイロードには誰のトークンか（sub）と、発行時点のパスワード世代
    （token_version）を入れる。署名があるおかげでサーバー側は DB を見なくても
    「このトークンは改ざんされていない」と確認できる（＝ステートレス）。
    ただし失効させたい場合（パスワードリセット等）は token_version を DB 側で
    上げることで、署名は有効なままでも dependencies.py 側で弾けるようにする。
    """
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "token_version": token_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> AccessTokenPayload:
    """アクセストークンを検証してペイロードを取り出す。

    署名不正・期限切れ・形式不正のいずれでも `InvalidAccessTokenError` にする。
    """
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise InvalidAccessTokenError(str(exc)) from exc

    sub = payload.get("sub")
    token_version = payload.get("token_version")
    if not isinstance(sub, str) or not isinstance(token_version, int):
        raise InvalidAccessTokenError("トークンのペイロードの形式が不正です")

    return {"sub": sub, "token_version": token_version}


# --- リフレッシュトークン（opaque トークン） ----------------------------------
#
# アクセストークンと違い、リフレッシュトークンは JWT にしない。
# 中身に意味を持たせず、ただのランダム文字列（opaque token）として発行し、
# DB 側で「このトークンは有効か」を管理する（失効・ローテーションのため）。


def generate_refresh_token() -> str:
    """URL セーフなランダム文字列を生成する（クライアントに渡す生トークン）。"""
    return secrets.token_urlsafe(32)


def hash_refresh_token(raw_token: str) -> str:
    """リフレッシュトークンのハッシュ値を計算する（DB にはこちらだけ保存）。

    リフレッシュトークンはパスワードと違い、こちらが十分な長さのランダム値を
    生成しているため、総当たり攻撃を遅くする Argon2id は不要。DB 内での
    検索（token_hash での一致検索）に使うだけなので、高速な SHA-256 で十分。
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
