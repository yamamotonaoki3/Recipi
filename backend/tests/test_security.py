"""app/security.py の単体テスト（DB 不要）。"""

from __future__ import annotations

import time
import uuid

import jwt
import pytest

from app.security import (
    InvalidAccessTokenError,
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    hash_security_answer,
    normalize_security_answer,
    verify_password,
    verify_password_or_dummy,
    verify_security_answer,
)


def test_password_hash_roundtrip():
    hashed = hash_password("TestPass123!")
    assert hashed != "TestPass123!"
    assert verify_password("TestPass123!", hashed) is True


def test_password_hash_rejects_wrong_password():
    hashed = hash_password("TestPass123!")
    assert verify_password("WrongPass123!", hashed) is False


def test_verify_password_or_dummy_matches_real_hash():
    hashed = hash_password("TestPass123!")
    assert verify_password_or_dummy("TestPass123!", hashed) is True


def test_verify_password_or_dummy_rejects_wrong_password():
    hashed = hash_password("TestPass123!")
    assert verify_password_or_dummy("WrongPass123!", hashed) is False


def test_verify_password_or_dummy_returns_false_without_leaking_user_absence():
    """ユーザーが存在しない（password_hash=None）場合も必ず False。

    タイミング攻撃対策の要は「None のときも Argon2 の検証を実行すること」
    自体（本テストでは検証結果だけを確認し、時間差の計測はしない）。
    """
    assert verify_password_or_dummy("anything", None) is False


def test_normalize_security_answer_trims_and_casefolds():
    assert normalize_security_answer("  Fluffy  ") == "fluffy"


def test_security_answer_hash_roundtrip_is_case_insensitive():
    hashed = hash_security_answer("Fluffy")
    assert verify_security_answer("  fluffy  ", hashed) is True


def test_security_answer_hash_rejects_wrong_answer():
    hashed = hash_security_answer("Fluffy")
    assert verify_security_answer("Rex", hashed) is False


def test_normalize_security_answer_unifies_full_width_and_half_width():
    """全角カナと半角カナの表記ゆれを NFKC 正規化で吸収する。"""
    assert normalize_security_answer("ラーメン") == normalize_security_answer("ﾗｰﾒﾝ")


def test_access_token_roundtrip():
    user_id = uuid.uuid4()
    token = create_access_token(user_id, token_version=3)
    payload = decode_access_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["token_version"] == 3


def test_access_token_rejects_tampered_signature():
    token = create_access_token(uuid.uuid4(), token_version=0)
    # 署名部分の先頭の文字を変える（base64url の末尾文字は「余りビット」に
    # あたることがあり、変えても実際のバイト列が変わらずすり抜けることが
    # ある。先頭寄りの文字なら確実にデコード結果が変わる）。
    header_and_payload, signature = token.rsplit(".", 1)
    tampered_char = "A" if signature[0] != "A" else "B"
    tampered_signature = tampered_char + signature[1:]
    tampered = f"{header_and_payload}.{tampered_signature}"
    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(tampered)


def test_access_token_rejects_expired_token():
    user_id = uuid.uuid4()
    # 期限切れの exp を直接埋め込んだトークンを自前で作る
    # （create_access_token は常に未来の exp を使うため）。
    from app.config import settings

    payload = {
        "sub": str(user_id),
        "token_version": 0,
        "iat": int(time.time()) - 120,
        "exp": int(time.time()) - 60,
    }
    expired_token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    with pytest.raises(InvalidAccessTokenError):
        decode_access_token(expired_token)


def test_refresh_token_hash_is_deterministic_and_not_reversible():
    raw = generate_refresh_token()
    assert hash_refresh_token(raw) == hash_refresh_token(raw)
    assert hash_refresh_token(raw) != raw


def test_generate_refresh_token_is_random():
    assert generate_refresh_token() != generate_refresh_token()
