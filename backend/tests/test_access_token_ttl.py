"""アクセストークンの寿命の決め方（Issue #245）。

秒指定を足しても、**分だけを指定したときの寿命が 1 秒も変わらない**ことが受け入れ基準。
そのため実際に JWT を発行して `exp - iat` を比べる（プロパティの戻り値だけを見ない）。

## 環境から隔離する

`Settings` は `.env.<APP_ENV>` と環境変数を読む。テストが走っている環境の値に
左右されないよう、**存在しないファイルを `_env_file` に渡し、TTL 関連の環境変数を
外してから**生成する（`tests/test_config.py` の既存の書き方に合わせる）。

また `app.security` はモジュール import 時に `settings` を参照するので、環境変数を
書き換えただけではトークン生成に反映されない。発行の検証は `settings` を
monkeypatch して行う。
"""

from __future__ import annotations

from pathlib import Path

import jwt
import pytest
from pydantic import ValidationError

from app.config import Settings

_TTL_ENV_VARS = ("ACCESS_TOKEN_TTL_MINUTES", "ACCESS_TOKEN_TTL_SECONDS")


def _isolate(monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env.test` と環境変数の影響を受けない状態にする。

    `_env_file` に存在しないファイルを渡すと必須項目も読めなくなるので、
    必要な最小限だけを架空の値で入れる（`tests/test_config.py` と同じ書き方）。
    """
    for name in _TTL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h:5432/d_test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-only-not-a-real-secret")


def _settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, **overrides: object) -> Settings:
    """環境から切り離した Settings を作る。"""
    _isolate(monkeypatch)
    return Settings(_env_file=tmp_path / ".env.missing", **overrides)  # type: ignore[arg-type]


# --- プロパティの決め方 ------------------------------------------------


def test_defaults_to_fifteen_minutes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    assert _settings(tmp_path, monkeypatch).access_token_ttl_seconds == 15 * 60


def test_minutes_are_multiplied_by_sixty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    s = _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_MINUTES=7)
    assert s.access_token_ttl_seconds == 7 * 60


def test_seconds_win_over_minutes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """分に既定値がある以上、秒を優先しないと秒指定が効かない。"""
    s = _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_MINUTES=15, ACCESS_TOKEN_TTL_SECONDS=30)
    assert s.access_token_ttl_seconds == 30


@pytest.mark.parametrize("value", [0, -1])
def test_non_positive_seconds_are_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, value: int
):
    with pytest.raises(ValidationError):
        _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_SECONDS=value)


def test_empty_string_seconds_is_a_configuration_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """`ACCESS_TOKEN_TTL_SECONDS=` は「未指定」にはならず、設定エラーになる。

    pydantic-settings は空文字を無視しない。example に「使うときは正の整数へ
    置き換える」と書いてあるのはこのため。
    """
    _isolate(monkeypatch)
    monkeypatch.setenv("ACCESS_TOKEN_TTL_SECONDS", "")
    with pytest.raises(ValidationError):
        Settings(_env_file=tmp_path / ".env.missing")


@pytest.mark.parametrize("minutes", [0, -5])
def test_minutes_keep_their_existing_behaviour(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, minutes: int
):
    """分の 0・負値に**新しい制約を足していない**（既存の挙動を変えない）。"""
    s = _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_MINUTES=minutes)
    assert s.access_token_ttl_seconds == minutes * 60


# --- 実際に発行した JWT で確かめる --------------------------------------


def _issue_and_measure(monkeypatch: pytest.MonkeyPatch, settings_obj: Settings) -> int:
    """`settings_obj` の設定でトークンを 1 本発行し、`exp - iat`（秒）を返す。"""
    import uuid

    import app.security as security

    monkeypatch.setattr(security, "settings", settings_obj)
    token = security.create_access_token(uuid.uuid4(), 0)
    payload = jwt.decode(
        token, settings_obj.JWT_SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}
    )
    return int(payload["exp"]) - int(payload["iat"])


def test_issued_token_lifetime_is_unchanged_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """秒を指定しないとき、発行されるトークンの寿命は従来どおり 900 秒。"""
    s = _settings(tmp_path, monkeypatch)
    assert _issue_and_measure(monkeypatch, s) == 900


def test_issued_token_lifetime_matches_the_minutes_setting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    s = _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_MINUTES=3)
    assert _issue_and_measure(monkeypatch, s) == 180


def test_issued_token_lifetime_uses_seconds_when_given(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """分とは違う値を渡して、秒のほうが使われることを確かめる。"""
    s = _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_MINUTES=15, ACCESS_TOKEN_TTL_SECONDS=45)
    assert _issue_and_measure(monkeypatch, s) == 45


def test_expired_token_is_rejected_and_a_fresh_one_is_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """短い秒数で発行したトークンが、期限到達後に**期限切れとして**弾かれる。

    E2E（#246）が成り立つ前提の確認。`sleep` に頼らず、発行時刻を過去にずらして
    期限切れの状態を作る。単なる改ざんトークンの 401 と区別するため、
    `InvalidAccessTokenError` の原因が期限切れであることまで見る。
    """
    import uuid
    from datetime import UTC, datetime, timedelta

    import app.security as security

    s = _settings(tmp_path, monkeypatch, ACCESS_TOKEN_TTL_SECONDS=30)
    monkeypatch.setattr(security, "settings", s)
    user_id = uuid.uuid4()

    # 期限内: 普通に検証できる。
    fresh = security.create_access_token(user_id, 0)
    assert security.decode_access_token(fresh)["sub"] == str(user_id)

    # 期限切れ: 30 秒の寿命に対して 31 秒前に発行したことにする。
    issued_at = datetime.now(UTC) - timedelta(seconds=31)
    expired = jwt.encode(
        {
            "sub": str(user_id),
            "token_version": 0,
            "iat": issued_at,
            "exp": issued_at + timedelta(seconds=s.access_token_ttl_seconds),
        },
        s.JWT_SECRET_KEY,
        algorithm="HS256",
    )
    with pytest.raises(security.InvalidAccessTokenError) as exc:
        security.decode_access_token(expired)
    assert "expired" in str(exc.value).lower()
