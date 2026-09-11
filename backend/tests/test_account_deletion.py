"""アカウント削除（`DELETE /users/me`）の結合テスト（Issue #71）。

BB（仕様ベース）: 関係をひととおり持つユーザーを削除し、本人の行が残らないこと、
旧トークンが 401 になること、生き残る他人のカウントが実数と一致すること、
画像キーがすべて削除キューに載ること。
WB（実装ベース）: キー収集は CASCADE の前でないと空になること、途中の例外で全体が
元に戻ること、カウントの各経路、pending の遅延削除、PUT 後の自己点検、並行処理。

テストデータは `testuser_` / `@example.com`。作った画像は MinIO・削除キュー・
uploads から後始末して残数 0 を確かめる（non-functional.md のテストデータ規約）。
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, select

from app import storage
from app.db import engine
from app.jobs import recount_counts
from app.jobs.storage_deletion import process_queue
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload
from app.models.user import User
from app.services import account as account_service
from tests.helpers import recipe_payload, signup, upload_image

pytestmark = pytest.mark.integration

ME_URL = "/api/v1/users/me"
RECIPES_URL = "/api/v1/recipes"
USERS_URL = "/api/v1/users"


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.refresh_token: str = body["refreshToken"]
        self.id = str(body["user"]["id"])
        self.uuid = uuid.UUID(self.id)


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
            assert not storage.object_exists(key)
            assert s.exec(select(Upload).where(Upload.key == key)).first() is None


def _image(client: TestClient, user: _User, keys: list[str]) -> str:
    key = upload_image(client, user.headers)
    keys.append(key)
    return key


def _follow(client: TestClient, a: _User, b: _User) -> None:
    assert client.post(f"{USERS_URL}/{b.id}/follow", headers=a.headers).status_code == 204


def _recipe(client: TestClient, owner: _User, **overrides: Any) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(**overrides), headers=owner.headers)
    assert res.status_code == 201, res.text
    rid: str = res.json()["id"]
    return rid


def _comment(client: TestClient, user: _User, rid: str, image_key: str | None = None) -> str:
    payload: dict[str, Any] = {"body": "作りました"}
    if image_key:
        payload["imageKey"] = image_key
    res = client.post(f"{RECIPES_URL}/{rid}/comments", json=payload, headers=user.headers)
    assert res.status_code == 201, res.text
    cid: str = res.json()["id"]
    return cid


def _scalar(sql: str, **params: Any) -> Any:
    with Session(engine) as s:
        return s.execute(text(sql), params).scalar_one()


def _user_counts(user_id: uuid.UUID) -> tuple[int, int]:
    with Session(engine) as s:
        row = s.execute(
            text("SELECT following_count, follower_count FROM users WHERE id = :id"),
            {"id": user_id},
        ).one()
        return int(row[0]), int(row[1])


def _real_user_counts(user_id: uuid.UUID) -> tuple[int, int]:
    return (
        _scalar("SELECT count(*) FROM follows WHERE follower_id = :id", id=user_id),
        _scalar("SELECT count(*) FROM follows WHERE followee_id = :id", id=user_id),
    )


def _recipe_counts(rid: str) -> tuple[int, int]:
    with Session(engine) as s:
        row = s.execute(
            text("SELECT favorite_count, comment_count FROM recipes WHERE id = :id"),
            {"id": uuid.UUID(rid)},
        ).one()
        return int(row[0]), int(row[1])


def _real_recipe_counts(rid: str) -> tuple[int, int]:
    rid_u = uuid.UUID(rid)
    return (
        _scalar("SELECT count(*) FROM favorites WHERE recipe_id = :id", id=rid_u),
        _scalar("SELECT count(*) FROM recipe_comments WHERE recipe_id = :id", id=rid_u),
    )


def _queued(key: str) -> list[PendingStorageDeletion]:
    with Session(engine) as s:
        return list(
            s.exec(select(PendingStorageDeletion).where(PendingStorageDeletion.key == key)).all()
        )


# 本人に関わる行の数（ロールバックの比較・削除後の 0 件確認に使う）。
_OWNED_COUNTS = {
    "users": "SELECT count(*) FROM users WHERE id = :me",
    "recipes": "SELECT count(*) FROM recipes WHERE user_id = :me",
    "ingredient_groups": (
        "SELECT count(*) FROM ingredient_groups g JOIN recipes r ON r.id = g.recipe_id"
        " WHERE r.user_id = :me"
    ),
    "ingredients": (
        "SELECT count(*) FROM ingredients i JOIN recipes r ON r.id = i.recipe_id"
        " WHERE r.user_id = :me"
    ),
    "steps": (
        "SELECT count(*) FROM steps s JOIN recipes r ON r.id = s.recipe_id WHERE r.user_id = :me"
    ),
    "follows": "SELECT count(*) FROM follows WHERE follower_id = :me OR followee_id = :me",
    "favorites": "SELECT count(*) FROM favorites WHERE user_id = :me",
    "recipe_comments": "SELECT count(*) FROM recipe_comments WHERE user_id = :me",
    "notifications": "SELECT count(*) FROM notifications WHERE user_id = :me OR actor_id = :me",
    "recipe_views": "SELECT count(*) FROM recipe_views WHERE user_id = :me",
    "notification_outbox": "SELECT count(*) FROM notification_outbox WHERE author_id = :me",
    "uploads": "SELECT count(*) FROM uploads WHERE user_id = :me",
    "refresh_tokens": "SELECT count(*) FROM refresh_tokens WHERE user_id = :me",
}


def _owned(me: uuid.UUID) -> dict[str, int]:
    return {name: int(_scalar(sql, me=me)) for name, sql in _OWNED_COUNTS.items()}


class _World:
    """削除される本人と、その周りの関係をひととおり作る。"""

    def __init__(self, client: TestClient, keys: list[str]) -> None:
        self.me = _User(client)
        self.friend = _User(client)  # 相互フォロー・お互いのレシピにお気に入りと感想
        self.fan = _User(client)  # 本人をフォローするだけ
        self.idol = _User(client)  # 本人がフォローするだけ
        me, friend = self.me, self.friend

        _follow(client, me, friend)
        _follow(client, friend, me)
        _follow(client, self.fan, me)
        _follow(client, me, self.idol)

        # 本人のレシピ（サムネ・手順画像つき）
        self.thumb = _image(client, me, keys)
        self.step_img = _image(client, me, keys)
        self.my_recipe = _recipe(
            client,
            me,
            thumbnailKey=self.thumb,
            steps=[{"position": 1, "body": "切る", "imageKey": self.step_img}],
        )
        # 友人のレシピ
        self.friend_recipe = _recipe(client, friend)

        # お気に入り（双方向）
        for who, rid in ((friend, self.my_recipe), (me, self.friend_recipe)):
            res = client.post(f"{RECIPES_URL}/{rid}/favorite", headers=who.headers)
            assert res.status_code == 204

        # 感想（双方向・画像つき）
        self.friends_comment_img = _image(client, friend, keys)
        _comment(client, friend, self.my_recipe, self.friends_comment_img)
        self.my_comment_img = _image(client, me, keys)
        self.my_comment = _comment(client, me, self.friend_recipe, self.my_comment_img)
        _comment(client, me, self.friend_recipe)  # 2 件目（comment_count を 2 減らす経路）

        # 閲覧履歴（本人が見る・他人が本人のレシピを見る）
        client.post(f"{RECIPES_URL}/{self.friend_recipe}/view", headers=me.headers)
        client.post(f"{RECIPES_URL}/{self.my_recipe}/view", headers=friend.headers)

        # アバター・未使用のアップロード（stored / pending）
        self.avatar = self._avatar(client, keys)
        self.stored = _image(client, me, keys)
        self.pending = f"uploads/{uuid.uuid4()}.png"
        keys.append(self.pending)
        with Session(engine) as s:
            s.add(
                Upload(
                    user_id=me.uuid,
                    key=self.pending,
                    status="pending",
                    content_type="image/png",
                    size_bytes=1,
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
            s.commit()

    def _avatar(self, client: TestClient, keys: list[str]) -> str:
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, "PNG")
        res = client.put(
            f"{ME_URL}/avatar",
            files={"file": ("a.png", buf.getvalue(), "image/png")},
            headers=self.me.headers,
        )
        assert res.status_code == 200, res.text
        key = _scalar("SELECT avatar_key FROM users WHERE id = :id", id=self.me.uuid)
        keys.append(key)
        return str(key)

    def image_keys(self) -> list[str]:
        return [
            self.thumb,
            self.step_img,
            self.friends_comment_img,
            self.my_comment_img,
            self.avatar,
            self.stored,
            self.pending,
        ]


# --- BB --------------------------------------------------------------------------


def test_delete_account_removes_everything_and_fixes_counts(
    client: TestClient, keys: list[str]
) -> None:
    w = _World(client, keys)
    me = w.me
    assert _owned(me.uuid)["recipes"] == 1

    res = client.delete(ME_URL, headers=me.headers)

    assert res.status_code == 204, res.text
    # 本人の行が 1 件も残らない（users 行そのものも）
    assert _owned(me.uuid) == dict.fromkeys(_OWNED_COUNTS, 0)
    # 本人のレシピに他人が付けた行も消える（recipe_id 側の CASCADE）
    rid = uuid.UUID(w.my_recipe)
    for table in ("favorites", "recipe_comments", "recipe_views", "notifications"):
        assert _scalar(f"SELECT count(*) FROM {table} WHERE recipe_id = :r", r=rid) == 0
    # 本人が他人のレシピに書いた感想への通知も消える（comment_id 側の CASCADE）
    assert (
        _scalar(
            "SELECT count(*) FROM notifications WHERE comment_id = :c", c=uuid.UUID(w.my_comment)
        )
        == 0
    )

    # 旧トークンは 401、リフレッシュもできない
    assert client.patch(ME_URL, json={}, headers=me.headers).status_code == 401
    refresh = client.post("/api/v1/auth/refresh", json={"refreshToken": me.refresh_token})
    assert refresh.status_code == 401

    # 生き残る他人のカウントが実数と一致
    for other in (w.friend, w.fan, w.idol):
        assert _user_counts(other.uuid) == _real_user_counts(other.uuid)
    assert _user_counts(w.friend.uuid) == (0, 0)
    assert _recipe_counts(w.friend_recipe) == _real_recipe_counts(w.friend_recipe) == (0, 0)

    # 画像キー 7 種が削除キューに 1 回ずつ
    for key in w.image_keys():
        rows = _queued(key)
        assert [r.reason for r in rows] == ["account_deleted"], key
    # pending だけは遅延削除（delete_after が未来）
    assert _queued(w.pending)[0].delete_after is not None
    assert all(_queued(k)[0].delete_after is None for k in w.image_keys() if k != w.pending)

    # 補正ジョブを流しても、関係者の数字は変わらない（＝ 削除 Tx の時点で正しい）
    before = [_user_counts(u.uuid) for u in (w.friend, w.fan, w.idol)]
    recipe_before = _recipe_counts(w.friend_recipe)
    with Session(engine) as s:
        recount_counts.recount_follow_counts(s)
        recount_counts.recount_favorite_counts(s)
        recount_counts.recount_comment_counts(s)
        s.commit()
    assert [_user_counts(u.uuid) for u in (w.friend, w.fan, w.idol)] == before
    assert _recipe_counts(w.friend_recipe) == recipe_before


def test_anonymous_is_401(client: TestClient) -> None:
    assert client.delete(ME_URL).status_code == 401


def test_user_without_relations_can_be_deleted(client: TestClient) -> None:
    lonely = _User(client)
    assert client.delete(ME_URL, headers=lonely.headers).status_code == 204
    assert _owned(lonely.uuid)["users"] == 0


# --- WB --------------------------------------------------------------------------


def test_keys_cannot_be_collected_after_cascade(client: TestClient, keys: list[str]) -> None:
    """キーの収集は CASCADE の前でないと空になる（順番を入れ替えると取りこぼす）。"""
    me = _User(client)
    thumb = _image(client, me, keys)
    _recipe(client, me, thumbnailKey=thumb)
    with Session(engine) as s:
        before = account_service.collect_account_keys(s, me.uuid)
        s.execute(text("DELETE FROM users WHERE id = :me"), {"me": me.uuid})
        after = account_service.collect_account_keys(s, me.uuid)
        s.rollback()
    assert (thumb, None) in before
    assert after == []
    assert client.delete(ME_URL, headers=me.headers).status_code == 204


def test_failure_midway_rolls_everything_back(
    client: TestClient, keys: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    w = _World(client, keys)
    owned_before = _owned(w.me.uuid)
    counts_before = [_user_counts(u.uuid) for u in (w.friend, w.fan, w.idol)]
    recipe_before = _recipe_counts(w.friend_recipe)
    token_before = _scalar("SELECT token_version FROM users WHERE id = :id", id=w.me.uuid)

    def boom(session: Session, me: uuid.UUID) -> None:
        raise RuntimeError("途中失敗の再現")

    monkeypatch.setattr(account_service, "_subtract_counts", boom)
    with Session(engine) as s:
        user = s.get(User, w.me.uuid)
        assert user is not None
        with pytest.raises(RuntimeError):
            account_service.delete_account(s, user)
        s.rollback()

    assert _owned(w.me.uuid) == owned_before
    assert [_user_counts(u.uuid) for u in (w.friend, w.fan, w.idol)] == counts_before
    assert _recipe_counts(w.friend_recipe) == recipe_before
    assert _scalar("SELECT token_version FROM users WHERE id = :id", id=w.me.uuid) == token_before
    assert all(_queued(k) == [] for k in w.image_keys())
    assert client.patch(ME_URL, json={}, headers=w.me.headers).status_code == 200

    monkeypatch.undo()
    assert client.delete(ME_URL, headers=w.me.headers).status_code == 204


@pytest.mark.parametrize("path", ["following", "follower", "favorite", "comment"])
def test_each_count_path(client: TestClient, path: str) -> None:
    me, other = _User(client), _User(client)
    rid = _recipe(client, other)
    if path == "following":
        _follow(client, me, other)
    elif path == "follower":
        _follow(client, other, me)
    elif path == "favorite":
        client.post(f"{RECIPES_URL}/{rid}/favorite", headers=me.headers)
    else:
        for _ in range(3):
            _comment(client, me, rid)

    assert client.delete(ME_URL, headers=me.headers).status_code == 204

    assert _user_counts(other.uuid) == _real_user_counts(other.uuid) == (0, 0)
    assert _recipe_counts(rid) == _real_recipe_counts(rid) == (0, 0)


def test_second_concurrent_deletion_is_401(client: TestClient) -> None:
    me = _User(client)
    with Session(engine) as s:
        user = s.get(User, me.uuid)
        assert user is not None
        # 別の接続が先に消した状況を作る
        with Session(engine) as other:
            other.execute(text("DELETE FROM users WHERE id = :me"), {"me": me.uuid})
            other.commit()
        with pytest.raises(Exception) as exc:
            account_service.delete_account(s, user)
        assert getattr(exc.value, "status_code", None) == 401


def test_pending_key_waits_until_delete_after(client: TestClient, keys: list[str]) -> None:
    me = _User(client)
    pending = f"uploads/{uuid.uuid4()}.png"
    keys.append(pending)
    storage.put_object(pending, b"x", "image/png")  # PUT が遅れて完了した状況
    with Session(engine) as s:
        s.add(
            Upload(
                user_id=me.uuid,
                key=pending,
                status="pending",
                content_type="image/png",
                size_bytes=1,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        s.commit()

    assert client.delete(ME_URL, headers=me.headers).status_code == 204
    row = _queued(pending)[0]
    assert row.delete_after is not None and row.delete_after > datetime.now(UTC)

    with Session(engine) as s:
        process_queue(s)
    assert storage.object_exists(pending)  # まだ消さない

    with Session(engine) as s:
        s.execute(
            text(
                "UPDATE pending_storage_deletions SET delete_after = now() - interval '1 second'"
                " WHERE key = :k"
            ),
            {"k": pending},
        )
        s.commit()
        process_queue(s)
    assert not storage.object_exists(pending)


def test_upload_untracked_after_put_is_queued(
    client: TestClient, keys: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """PUT している間に管理行が消されていたら、キーを削除キューに積み直して 500。"""
    me = _User(client)
    real_put = storage.put_object
    seen: list[str] = []

    def slow_put(key: str, data: bytes, content_type: str) -> None:
        seen.append(key)
        keys.append(key)
        real_put(key, data, content_type)
        with Session(engine) as s:  # PUT の最中に退会・GC が行を削除キューへ移した
            s.execute(text("DELETE FROM uploads WHERE key = :k"), {"k": key})
            s.commit()

    monkeypatch.setattr(storage, "put_object", slow_put)
    res = client.post(
        "/api/v1/images",
        files={"file": ("a.png", _tiny_png(), "image/png")},
        headers=me.headers,
    )
    assert res.status_code == 500, res.text
    assert [r.reason for r in _queued(seen[0])] == ["upload_untracked_after_put"]


def _tiny_png() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


def _lock_waiters() -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid()"
                    " AND state = 'active' AND wait_event_type = 'Lock'"
                )
            ).scalar_one()
        )


def _wait_until(cond: Any, what: str) -> None:
    deadline = datetime.now(UTC) + timedelta(seconds=20)
    while not cond() and datetime.now(UTC) < deadline:
        threading.Event().wait(0.02)
    assert cond(), what


def test_concurrent_operations_keep_invariants(client: TestClient, keys: list[str]) -> None:
    """退会の最中に来た他人のフォロー・感想、本人のアップロードとレシピ作成。

    投稿（recipes → users）と退会（users → recipes）はロックの向きが逆なので、
    どちらが先にコミットするかは決まらない。どちらが勝っても成り立つことを確かめる:
    本人は消える・他人の操作は 500 にならない・カウントは実数どおり・画像は孤児にならない。
    """
    me, friend, stranger = _User(client), _User(client), _User(client)
    r1, r2 = _recipe(client, me), _recipe(client, me)
    recipe_a, recipe_b = sorted([r1, r2])  # 退会は id 順にロックするので、A で必ず止まる
    results: dict[str, int] = {}

    def run(name: str, fn: Any) -> threading.Thread:
        def target() -> None:
            try:
                results[name] = fn().status_code
            except Exception:  # noqa: BLE001
                results[name] = 500

        t = threading.Thread(target=target)
        t.start()
        return t

    holder = Session(engine)
    try:
        holder.execute(
            text("SELECT id FROM recipes WHERE id = :id FOR NO KEY UPDATE"),
            {"id": uuid.UUID(recipe_a)},
        )
        base = _lock_waiters()
        threads = [run("delete", lambda: client.delete(ME_URL, headers=me.headers))]
        _wait_until(lambda: _lock_waiters() >= base + 1, "退会がレシピ A のロック待ちに入らない")
        threads.append(
            run(
                "follow",
                lambda: client.post(f"{USERS_URL}/{me.id}/follow", headers=stranger.headers),
            )
        )
        threads.append(
            run(
                "comment",
                lambda: client.post(
                    f"{RECIPES_URL}/{recipe_b}/comments",
                    json={"body": "感想"},
                    headers=friend.headers,
                ),
            )
        )
        threads.append(
            run(
                "upload",
                lambda: client.post(
                    "/api/v1/images",
                    files={"file": ("a.png", _tiny_png(), "image/png")},
                    headers=me.headers,
                ),
            )
        )
        threads.append(
            run(
                "create",
                lambda: client.post(RECIPES_URL, json=recipe_payload(), headers=me.headers),
            )
        )
        _wait_until(lambda: _lock_waiters() >= base + 3, "他の操作がロック待ちに入らない")
    finally:
        holder.rollback()
        holder.close()
    for t in threads:
        t.join(timeout=60)

    assert results["delete"] == 204, results
    assert _owned(me.uuid)["users"] == 0
    assert results["follow"] in (204, 404), results
    assert results["comment"] in (201, 404), results
    assert results["upload"] in (401, 500), results  # 本人のアップロードは失敗（孤児なし）
    assert results["create"] in (401,), results
    for u in (friend, stranger):
        assert _user_counts(u.uuid) == _real_user_counts(u.uuid)
    # 本人に紐づくアップロード行もオブジェクトも残っていない（PUT されたものは削除キューへ）
    assert _scalar("SELECT count(*) FROM uploads WHERE user_id = :me", me=me.uuid) == 0


def test_follow_by_deleted_user_after_lock_is_401(client: TestClient) -> None:
    """ロック待ちの間にフォローする本人が退会していたら、FK 違反の 500 ではなく 401。"""
    from app.services import follow as follow_service

    me, other = _User(client), _User(client)
    with Session(engine) as s:
        user = s.get(User, me.uuid)
        assert user is not None
        with Session(engine) as killer:
            killer.execute(text("DELETE FROM users WHERE id = :me"), {"me": me.uuid})
            killer.commit()
        with pytest.raises(Exception) as exc:
            follow_service.follow(s, user, other.uuid)
        assert getattr(exc.value, "status_code", None) == 401
