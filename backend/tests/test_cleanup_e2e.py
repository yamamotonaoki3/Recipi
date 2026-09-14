"""E2E の後始末スクリプト（`scripts/cleanup_e2e.py`）のテスト（Issue #135）。

BB: 対象（`e2euser_…_<run-id>@example.com`）だけが消え、`testuser_`・別 run-id は残る。
    画像キーは削除キューに積まれ、残数は 0。
WB: 安全装置（APP_ENV・ホスト・対象の指定・`--all` の環境変数・`--yes`）、巻き添えの
    種類ごとに「何も消さない」、dry-run はロールバックする、共有キーは積まない。

テストデータは `e2euser_` / `testuser_` と `@example.com`。作った画像は MinIO・削除キュー・
uploads から後始末する。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app import storage
from app.db import engine
from scripts import cleanup_e2e
from scripts.cleanup_e2e import CleanupError, assert_cleanup_target, cleanup, email_pattern
from tests.helpers import recipe_payload, upload_image

SIGNUP_URL = "/api/v1/auth/signup"
RECIPES_URL = "/api/v1/recipes"
USERS_URL = "/api/v1/users"
RESET_REQUEST_URL = "/api/v1/auth/password-reset/request"
GRACE = timedelta(hours=1)


# --- 単体（DB 不要）-------------------------------------------------------------


@pytest.mark.parametrize(
    ("app_env", "database_url"),
    [
        ("development", "postgresql+psycopg://u:p@localhost:5432/recipi"),
        ("test", "postgresql+psycopg://u:p@127.0.0.1:5432/recipi_test"),
        ("development", "postgresql+psycopg://u:p@postgres:5432/recipi"),
    ],
)
def test_accepts_local_development_and_test(app_env: str, database_url: str) -> None:
    assert_cleanup_target(app_env, database_url)


@pytest.mark.parametrize(
    ("app_env", "database_url"),
    [
        ("production", "postgresql+psycopg://u:p@localhost:5432/recipi"),
        ("demo", "postgresql+psycopg://u:p@localhost:5432/recipi_demo"),
        ("development", "postgresql+psycopg://u:p@db.example.com:5432/recipi"),
    ],
)
def test_rejects_non_local_or_non_dev_target(app_env: str, database_url: str) -> None:
    with pytest.raises(CleanupError, match="ローカル"):
        assert_cleanup_target(app_env, database_url)


def test_email_pattern_requires_exactly_one_target() -> None:
    with pytest.raises(CleanupError, match="どちらか一方"):
        email_pattern(None, all_users=False)
    with pytest.raises(CleanupError, match="どちらか一方"):
        email_pattern("abc", all_users=True)
    assert email_pattern(None, all_users=True) == r"e2euser\_%@example.com"
    assert email_pattern("1726-42", all_users=False) == r"e2euser\_%\_1726-42@example.com"


@pytest.mark.parametrize("run_id", ["a_b", "a%b", "ABC", "", "x;y"])
def test_email_pattern_rejects_unsafe_run_id(run_id: str) -> None:
    with pytest.raises(CleanupError, match="英小文字"):
        email_pattern(run_id, all_users=False)


def test_main_requires_env_for_all(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(cleanup_e2e.ALLOW_ALL_ENV, raising=False)
    assert cleanup_e2e.main(["--all", "--yes"]) == 2


def test_main_requires_yes_unless_dry_run() -> None:
    assert cleanup_e2e.main(["--run-id", "abc"]) == 2


def test_main_rejects_missing_target() -> None:
    assert cleanup_e2e.main(["--yes"]) == 2


# --- 結合（テスト DB ＋ MinIO）---------------------------------------------------


class _User:
    """API でサインアップしたユーザー（メールを指定できるよう helpers.signup は使わない）。"""

    def __init__(self, client: TestClient, email: str) -> None:
        res = client.post(
            SIGNUP_URL,
            json={
                "email": email,
                "password": "TestPass123!",
                "displayName": "E2E Cleanup",
                "securityQuestion": "好きな食べ物は？",
                "securityAnswer": "ラーメン",
            },
        )
        assert res.status_code == 201, res.text
        body = res.json()
        self.email = email
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = uuid.UUID(str(body["user"]["id"]))


def _e2e(client: TestClient, run_id: str) -> _User:
    return _User(client, f"e2euser_cleanup_{uuid.uuid4().hex[:8]}_{run_id}@example.com")


def _plain(client: TestClient) -> _User:
    return _User(client, f"testuser_{uuid.uuid4().hex}@example.com")


def _recipe(client: TestClient, owner: _User, **overrides: Any) -> uuid.UUID:
    res = client.post(RECIPES_URL, json=recipe_payload(**overrides), headers=owner.headers)
    assert res.status_code == 201, res.text
    return uuid.UUID(res.json()["id"])


def _count(sql: str, **params: Any) -> int:
    with Session(engine) as s:
        return int(s.execute(text(sql), params).scalar_one())


def _user_exists(user: _User) -> bool:
    return _count("SELECT count(*) FROM users WHERE id = :id", id=user.id) == 1


def _run_id() -> str:
    return uuid.uuid4().hex[:12]


@pytest.fixture
def keys() -> Iterator[list[str]]:
    """テストで作った画像キーを記録し、最後に MinIO・削除キュー・uploads から片付ける。"""
    recorded: list[str] = []
    yield recorded
    with Session(engine) as s:
        for key in recorded:
            s.execute(text("DELETE FROM pending_storage_deletions WHERE key = :k"), {"k": key})
            s.execute(text("DELETE FROM uploads WHERE key = :k"), {"k": key})
        s.commit()
    for key in recorded:
        storage.delete_object(key)


def _run(pattern: str, *, dry_run: bool = False) -> cleanup_e2e.CleanupReport:
    with Session(engine) as session:
        return cleanup(session, pattern, dry_run=dry_run, pending_grace=GRACE)


@pytest.mark.integration
# uploads 行の削除と CASCADE の順番がずれると SQLAlchemy が警告を出す（0 行を消そうとした）。
# 警告をエラーにして、その順番の誤りを検知する。
@pytest.mark.filterwarnings("error::sqlalchemy.exc.SAWarning")
def test_deletes_only_the_target_run_and_queues_images(client: TestClient, keys: list[str]) -> None:
    run_id = _run_id()
    author = _e2e(client, run_id)
    reader = _e2e(client, run_id)
    other_run = _e2e(client, _run_id())
    plain = _plain(client)

    thumb = upload_image(client, author.headers)
    comment_image = upload_image(client, reader.headers)
    unused = upload_image(client, author.headers)
    keys.extend([thumb, comment_image, unused])

    rid = _recipe(client, author, thumbnailKey=thumb)
    assert client.post(f"{USERS_URL}/{author.id}/follow", headers=reader.headers).status_code == 204
    assert client.post(f"{RECIPES_URL}/{rid}/favorite", headers=reader.headers).status_code in (
        200,
        201,
        204,
    )
    res = client.post(
        f"{RECIPES_URL}/{rid}/comments",
        json={"body": "[E2E_TEST] おいしかった", "imageKey": comment_image},
        headers=reader.headers,
    )
    assert res.status_code == 201, res.text

    report = _run(email_pattern(run_id, all_users=False))

    assert report.deleted
    assert sorted(report.users) == sorted([author.id, reader.id])
    assert not _user_exists(author) and not _user_exists(reader)
    # 別の実行・普通のユーザーは残る。
    assert _user_exists(other_run) and _user_exists(plain)
    assert _count("SELECT count(*) FROM recipes WHERE id = :id", id=rid) == 0
    # 画像はサムネイル・感想・未使用アップロードの 3 種類とも削除キューへ。
    queued = _count(
        "SELECT count(*) FROM pending_storage_deletions "
        "WHERE key = ANY(CAST(:k AS text[])) AND reason = :r",
        k=[thumb, comment_image, unused],
        r=cleanup_e2e.DELETION_REASON,
    )
    assert queued == 3


@pytest.mark.integration
def test_deletes_password_reset_attempts_of_the_target_only(client: TestClient) -> None:
    """再設定の試行記録は users に紐付かないので、メールのパターンで消す（Issue #149）。"""
    run_id = _run_id()
    e2e = _e2e(client, run_id)
    plain = _plain(client)
    # 登録済み・未登録（同じ run-id のメール）・対象外の 3 通りで試行記録を作る。
    unregistered = f"e2euser_resetnone_{uuid.uuid4().hex[:8]}_{run_id}@example.com"
    for email in (e2e.email, unregistered, plain.email):
        client.post(RESET_REQUEST_URL, json={"email": email})

    report = _run(email_pattern(run_id, all_users=False), dry_run=True)
    assert report.reset_attempts == 2

    _run(email_pattern(run_id, all_users=False))

    count_sql = "SELECT count(*) FROM password_reset_attempts WHERE email = :e"
    assert _count(count_sql, e=e2e.email) == 0
    assert _count(count_sql, e=unregistered) == 0
    # 対象外（testuser_）の記録は残る。
    assert _count(count_sql, e=plain.email) == 1


@pytest.mark.integration
def test_dry_run_counts_without_deleting(client: TestClient) -> None:
    run_id = _run_id()
    user = _e2e(client, run_id)
    _recipe(client, user)

    report = _run(email_pattern(run_id, all_users=False), dry_run=True)

    assert report.users == [user.id]
    assert len(report.recipes) == 1
    assert not report.deleted
    assert _user_exists(user)


@pytest.mark.integration
@pytest.mark.parametrize("kind", ["follow", "favorite", "comment", "follow_back"])
def test_collateral_blocks_deletion(client: TestClient, kind: str) -> None:
    run_id = _run_id()
    e2e = _e2e(client, run_id)
    plain = _plain(client)
    rid = _recipe(client, e2e)

    if kind == "follow":
        # E2E ユーザーが普通のユーザーをフォロー（相手のフォロワー数がずれる）。
        client.post(f"{USERS_URL}/{plain.id}/follow", headers=e2e.headers)
    elif kind == "follow_back":
        client.post(f"{USERS_URL}/{e2e.id}/follow", headers=plain.headers)
    elif kind == "favorite":
        # 普通のユーザーが E2E のレシピにお気に入り。
        client.post(f"{RECIPES_URL}/{rid}/favorite", headers=plain.headers)
    else:
        client.post(
            f"{RECIPES_URL}/{rid}/comments",
            json={"body": "作りました"},
            headers=plain.headers,
        )

    with pytest.raises(CleanupError, match="何も消しませんでした"):
        _run(email_pattern(run_id, all_users=False))
    assert _user_exists(e2e)
    assert _count("SELECT count(*) FROM recipes WHERE id = :id", id=rid) == 1


@pytest.mark.integration
def test_collateral_on_other_users_recipe(client: TestClient) -> None:
    """E2E ユーザーが普通のユーザーのレシピに感想を書いていたら止まる。"""
    run_id = _run_id()
    e2e = _e2e(client, run_id)
    plain = _plain(client)
    rid = _recipe(client, plain)
    res = client.post(
        f"{RECIPES_URL}/{rid}/comments", json={"body": "作りました"}, headers=e2e.headers
    )
    assert res.status_code == 201, res.text

    with pytest.raises(CleanupError, match="comments_on_other_recipes"):
        _run(email_pattern(run_id, all_users=False))
    assert _user_exists(e2e)
