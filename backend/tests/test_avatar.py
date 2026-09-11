"""アバター `PUT` / `DELETE /users/me/avatar` の結合テスト（Issue #67）。

実 PostgreSQL ＋ 実 MinIO に対して実行する。features/image.md §3・§5・§6、
processing-model.md §6。

BB: 設定 / 差し替え / 削除、非対応形式・サイズ超過は 400、未認証は 401、
`avatarUrl` が一覧カード・詳細・プロフィール・履歴・フォロー一覧に出る。
WB: 保存の 3 段手順で②（ストレージ保存）や③（確定）が失敗しても
`avatar_key` が書き換わらないこと。同時に差し替えても孤児オブジェクトが残らないこと。

## 後始末

このファイルで作ったオブジェクト・削除キューの行・`uploads` 行は、`tracked_keys`
fixture がテストの最後にすべて消し、残数 0 を確かめる（non-functional.md の
テストデータ規約）。キーは `storage.put_object` を包んで記録するので、失敗の経路で
応答に出てこなかったキーも漏れなく拾える。
"""

from __future__ import annotations

import io
import threading
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text
from sqlmodel import Session, delete, select, update

from app import storage
from app.config import settings
from app.db import engine
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload
from app.models.user import User
from tests.helpers import recipe_payload, signup

pytestmark = pytest.mark.integration

USERS_URL = "/api/v1/users"
AVATAR_URL = f"{USERS_URL}/me/avatar"
RECIPES_URL = "/api/v1/recipes"


# --- 道具 ---------------------------------------------------------------


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = str(body["user"]["id"])
        self.uuid = uuid.UUID(self.id)


def _png(color: tuple[int, int, int] = (40, 150, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), color).save(buf, "PNG")
    return buf.getvalue()


def _put(
    client: TestClient,
    user: _User,
    data: bytes | None = None,
    *,
    filename: str = "avatar.png",
    content_type: str = "image/png",
) -> Any:
    return client.put(
        AVATAR_URL,
        headers=user.headers,
        files={"file": (filename, data if data is not None else _png(), content_type)},
    )


def _key_of(url: str) -> str:
    """表示用 URL からオブジェクトキーを取り出す（URL = 公開ベース ＋ "/" ＋ キー）。"""
    base = settings.S3_PUBLIC_URL_BASE.rstrip("/") + "/"
    assert url.startswith(base), url
    return url[len(base) :]


def _avatar_key(user: _User) -> str | None:
    """DB 上の現在の `avatar_key`（毎回新しいセッションで読む）。"""
    with Session(engine) as s:
        row = s.get(User, user.uuid)
        assert row is not None
        return row.avatar_key


def _upload(key: str) -> Upload | None:
    with Session(engine) as s:
        return s.exec(select(Upload).where(Upload.key == key)).first()


def _queued_reasons(key: str) -> list[str]:
    """削除キューに載っているそのキーの理由の一覧（載っていなければ空）。"""
    with Session(engine) as s:
        rows = s.exec(select(PendingStorageDeletion).where(PendingStorageDeletion.key == key)).all()
        return [r.reason for r in rows]


@pytest.fixture
def tracked_keys(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[str]]:
    """保存されたオブジェクトキーを記録し、テストの最後にすべて片付ける。"""
    keys: list[str] = []
    original_put = storage.put_object

    def recording_put(key: str, data: bytes, content_type: str) -> None:
        keys.append(key)
        original_put(key, data, content_type)

    monkeypatch.setattr(storage, "put_object", recording_put)
    yield keys

    # --- 後始末（残数 0 を確かめる） ---
    with Session(engine) as s:
        for key in keys:
            s.exec(delete(PendingStorageDeletion).where(PendingStorageDeletion.key == key))  # type: ignore[arg-type]
            s.exec(delete(Upload).where(Upload.key == key))  # type: ignore[arg-type]
            s.exec(update(User).where(User.avatar_key == key).values(avatar_key=None))  # type: ignore[arg-type]
        s.commit()
        for key in keys:
            storage.delete_object(key)
            assert not storage.object_exists(key)
            assert s.exec(select(Upload).where(Upload.key == key)).first() is None
            assert (
                s.exec(
                    select(PendingStorageDeletion).where(PendingStorageDeletion.key == key)
                ).first()
                is None
            )


# --- 設定 / 差し替え / 削除 ----------------------------------------------


def test_set_avatar_saves_object_and_updates_profile(
    client: TestClient, tracked_keys: list[str]
) -> None:
    me = _User(client)

    res = _put(client, me)

    assert res.status_code == 200, res.text
    url = res.json()["avatarUrl"]
    key = _key_of(url)
    assert storage.object_exists(key)
    assert _avatar_key(me) == key
    row = _upload(key)
    assert row is not None and row.status == "consumed"
    # 直後の別リクエストで見える（応答を返す前に commit している）。
    profile = client.get(f"{USERS_URL}/{me.id}", headers=me.headers).json()
    assert profile["avatarUrl"] == url


def test_replace_queues_old_key(client: TestClient, tracked_keys: list[str]) -> None:
    """差し替えで旧キーが削除キューに `avatar_replaced` で載り、旧キーの管理行は消える。"""
    me = _User(client)
    old_key = _key_of(_put(client, me, _png((200, 10, 10))).json()["avatarUrl"])

    res = _put(client, me, _png((10, 10, 200)))

    assert res.status_code == 200, res.text
    new_key = _key_of(res.json()["avatarUrl"])
    assert new_key != old_key
    assert _avatar_key(me) == new_key
    assert _queued_reasons(old_key) == ["avatar_replaced"]
    assert _upload(old_key) is None  # 管理行は削除キューへ移った時点で役目を終える
    new_row = _upload(new_key)
    assert new_row is not None and new_row.status == "consumed"
    assert _queued_reasons(new_key) == []


def test_delete_avatar_queues_key_and_is_idempotent(
    client: TestClient, tracked_keys: list[str]
) -> None:
    me = _User(client)
    key = _key_of(_put(client, me).json()["avatarUrl"])

    first = client.delete(AVATAR_URL, headers=me.headers)
    second = client.delete(AVATAR_URL, headers=me.headers)

    assert first.status_code == 204, first.text
    assert second.status_code == 204, second.text
    assert _avatar_key(me) is None
    assert _queued_reasons(key) == ["avatar_deleted"]  # 2 回目で増えない
    profile = client.get(f"{USERS_URL}/{me.id}", headers=me.headers).json()
    assert profile["avatarUrl"] is None


def test_delete_without_avatar_is_204(client: TestClient) -> None:
    me = _User(client)
    res = client.delete(AVATAR_URL, headers=me.headers)
    assert res.status_code == 204, res.text


# --- 入力の不正 ------------------------------------------------------------


def _upload_count(user: _User) -> int:
    with Session(engine) as s:
        return len(s.exec(select(Upload).where(Upload.user_id == user.uuid)).all())


def test_unsupported_format_is_400_and_creates_nothing(
    client: TestClient, tracked_keys: list[str]
) -> None:
    """画像でないデータは 400。管理行もオブジェクトも作らない（検証を先に行う）。"""
    me = _User(client)

    res = _put(client, me, b"this is not an image", filename="avatar.png")

    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"
    assert _upload_count(me) == 0
    assert tracked_keys == []
    assert _avatar_key(me) is None


def test_too_large_is_400_and_creates_nothing(client: TestClient, tracked_keys: list[str]) -> None:
    me = _User(client)

    res = _put(client, me, b"0" * (settings.IMAGE_MAX_BYTES + 1))

    assert res.status_code == 400, res.text
    assert _upload_count(me) == 0
    assert tracked_keys == []


def test_requires_auth(client: TestClient) -> None:
    assert client.put(AVATAR_URL, files={"file": ("a.png", _png(), "image/png")}).status_code == 401
    assert client.delete(AVATAR_URL).status_code == 401


# --- avatarUrl がいろいろな場所に出る ---------------------------------------


def _find(items: list[dict[str, Any]], recipe_id: str) -> dict[str, Any]:
    for item in items:
        if item["id"] == recipe_id:
            return item
    raise AssertionError(f"{recipe_id} が見つからない")


def _feed_item(client: TestClient, viewer: _User, recipe_id: str) -> dict[str, Any]:
    cursor: str | None = None
    for _ in range(20):
        params: dict[str, Any] = {"feed": "all", "limit": 50}
        if cursor:
            params["cursor"] = cursor
        page = client.get(RECIPES_URL, params=params, headers=viewer.headers).json()
        for item in page["items"]:
            if item["id"] == recipe_id:
                found: dict[str, Any] = item
                return found
        cursor = page["nextCursor"]
        if not cursor:
            break
    raise AssertionError("フィードにレシピが見つからない")


def test_avatar_url_is_reflected_everywhere(client: TestClient, tracked_keys: list[str]) -> None:
    """一覧カード・詳細・プロフィール・履歴・フォロー一覧の投稿者に `avatarUrl` が出る。"""
    owner = _User(client)
    viewer = _User(client)
    url = _put(client, owner).json()["avatarUrl"]
    res = client.post(RECIPES_URL, json=recipe_payload(isPublic=True), headers=owner.headers)
    assert res.status_code == 201, res.text
    recipe_id = res.json()["id"]
    assert client.post(f"{USERS_URL}/{owner.id}/follow", headers=viewer.headers).status_code == 204
    assert client.post(f"{RECIPES_URL}/{recipe_id}/view", headers=viewer.headers).status_code == 204

    def get(path: str, user: _User) -> Any:
        r = client.get(path, headers=user.headers)
        assert r.status_code == 200, r.text
        return r.json()

    assert get(f"{USERS_URL}/{owner.id}", owner)["avatarUrl"] == url  # 本人向け
    assert get(f"{USERS_URL}/{owner.id}", viewer)["avatarUrl"] == url  # 他人向け
    assert get(f"{RECIPES_URL}/{recipe_id}", viewer)["author"]["avatarUrl"] == url  # 詳細
    assert _feed_item(client, viewer, recipe_id)["author"]["avatarUrl"] == url  # フィード
    mine = get(f"{USERS_URL}/me/recipes", owner)["items"]
    assert _find(mine, recipe_id)["author"]["avatarUrl"] == url  # 自分のレシピ一覧
    theirs = get(f"{USERS_URL}/{owner.id}/recipes", viewer)["items"]
    assert _find(theirs, recipe_id)["author"]["avatarUrl"] == url  # ユーザーのレシピ一覧
    history = get(f"{USERS_URL}/me/history", viewer)["items"]
    assert _find(history, recipe_id)["author"]["avatarUrl"] == url  # 閲覧履歴
    following = get(f"{USERS_URL}/me/following", viewer)["items"]
    assert [row["avatarUrl"] for row in following] == [url]  # フォロー一覧


# --- 3 段手順の途中で失敗したとき -------------------------------------------


def test_storage_failure_keeps_avatar_key(
    client: TestClient, tracked_keys: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """②（ストレージ保存）で失敗 → 500。`avatar_key` は変わらず、新キーの行は pending のまま。"""
    me = _User(client)
    old_key = _key_of(_put(client, me).json()["avatarUrl"])

    def failing_put(key: str, data: bytes, content_type: str) -> None:
        tracked_keys.append(key)  # 後始末のために記録してから失敗させる
        raise RuntimeError("ストレージが落ちている想定")

    monkeypatch.setattr(storage, "put_object", failing_put)
    res = _put(client, me, _png((1, 2, 3)))

    assert res.status_code == 500, res.text
    assert res.json()["error"]["code"] == "STORAGE_ERROR"
    assert _avatar_key(me) == old_key
    new_key = tracked_keys[-1]
    row = _upload(new_key)
    assert row is not None and row.status == "pending"  # 期限が来たら GC が回収する
    assert _queued_reasons(old_key) == []  # 旧アバターは消されていない


@pytest.mark.parametrize("mode", ["deleted", "expired"])
def test_finalize_failure_keeps_avatar_key(
    client: TestClient,
    tracked_keys: list[str],
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    """③の時点で新キーの管理行が消えていた / 期限切れ → 500。

    `avatar_key` は変わらず、保存済みの新キーは削除キューに載る（孤児にしない）。
    再現のため、保存が済んだ直後に**別の DB セッションから**管理行を消す（期限切れに
    する）。stage_upload が先に行を作るので、テスト開始前に消しても再現できない。
    """
    me = _User(client)
    old_key = _key_of(_put(client, me).json()["avatarUrl"])
    recording_put: Callable[[str, bytes, str], None] = storage.put_object

    def put_then_break_row(key: str, data: bytes, content_type: str) -> None:
        recording_put(key, data, content_type)
        with Session(engine) as s:
            row = s.exec(select(Upload).where(Upload.key == key)).one()
            if mode == "deleted":
                s.delete(row)
            else:
                row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
                s.add(row)
            s.commit()

    monkeypatch.setattr(storage, "put_object", put_then_break_row)
    res = _put(client, me, _png((4, 5, 6)))

    assert res.status_code == 500, res.text
    assert _avatar_key(me) == old_key
    new_key = tracked_keys[-1]
    # 行が消えていた場合は、PUT 直後の自己点検（Issue #71）が先に気づいて積む。
    expected = "upload_untracked_after_put" if mode == "deleted" else "avatar_finalize_failed"
    assert _queued_reasons(new_key) == [expected]
    assert _queued_reasons(old_key) == []


# --- 同時に差し替えても孤児が残らない ---------------------------------------


def _lock_waiters() -> int:
    """users 行の `FOR NO KEY UPDATE` でロック待ちになっている接続の数。"""
    with engine.connect() as conn:
        count = conn.execute(
            text(
                """
                SELECT count(*)
                FROM pg_stat_activity
                WHERE pid <> pg_backend_pid()
                  AND state = 'active'
                  AND wait_event_type = 'Lock'
                  AND query ILIKE '%FROM users%'
                  AND query ILIKE '%FOR NO KEY UPDATE%'
                """
            )
        ).scalar_one()
    return int(count)


@pytest.mark.parametrize("second_op", ["put", "delete"])
def test_concurrent_changes_leave_no_orphan(
    client: TestClient, tracked_keys: list[str], second_op: str
) -> None:
    """アバターの PUT × PUT、PUT × DELETE が同時に来ても、孤児オブジェクトが残らない。

    ## 決定的に再現する仕掛け

    テストが先に**自分の接続で対象ユーザーの行をロック**しておき、2 本のリクエストを
    別スレッドで投げる。どちらもリクエストの最初（`get_current_user`）で**ロック前の
    `avatar_key` を読み込んだ後**、確定の段階で users 行のロックを取りに来て待たされる。
    2 本とも待ちに入ったのを `pg_stat_activity` で確かめてから（固定 sleep に頼らない）
    ロックを離すと、2 本目は必ず「1 本目がコミットした後」に進む。

    確定の段階で `avatar_key` を**読み直していない**実装だと、2 本目は古い値を
    旧キーだと思い込み、1 本目が設定したキーが誰にも指されないまま残る（孤児）。
    """
    owner = _User(client)
    initial_key = _key_of(_put(client, owner, _png((9, 9, 9))).json()["avatarUrl"])
    statuses: list[int] = []
    guard = threading.Lock()

    def do_put(color: tuple[int, int, int]) -> None:
        r = _put(client, owner, _png(color))
        with guard:
            statuses.append(r.status_code)

    def do_delete() -> None:
        r = client.delete(AVATAR_URL, headers=owner.headers)
        with guard:
            statuses.append(r.status_code)

    first = threading.Thread(target=do_put, args=((200, 0, 0),))
    second = (
        threading.Thread(target=do_put, args=((0, 0, 200),))
        if second_op == "put"
        else threading.Thread(target=do_delete)
    )

    lock_session = Session(engine)
    try:
        lock_session.exec(
            select(User.id).where(User.id == owner.uuid).with_for_update(key_share=True)
        ).one()
        first.start()
        second.start()
        deadline = datetime.now(UTC) + timedelta(seconds=20)
        while _lock_waiters() < 2 and datetime.now(UTC) < deadline:
            threading.Event().wait(0.02)
        assert _lock_waiters() >= 2, "2 本のリクエストがロック待ちに入らなかった"
    finally:
        lock_session.rollback()  # ロックを離す
        lock_session.close()
    first.join(timeout=30)
    second.join(timeout=30)

    assert not first.is_alive() and not second.is_alive()
    expected = [200, 200] if second_op == "put" else [200, 204]
    assert sorted(statuses) == sorted(expected), statuses

    final_key = _avatar_key(owner)
    all_keys = set(tracked_keys)
    assert initial_key in all_keys
    new_keys = all_keys - {initial_key}

    if second_op == "put":
        assert len(new_keys) == 2
        assert final_key in new_keys
        loser = (new_keys - {final_key}).pop()
        assert _queued_reasons(initial_key) == ["avatar_replaced"]
        assert _queued_reasons(loser) == ["avatar_replaced"]
        assert _queued_reasons(final_key) == []
    else:
        assert len(new_keys) == 1
        put_key = new_keys.pop()
        # 最初のアバターは必ず消される。しかも**ちょうど 1 回だけ**積まれる。
        # 読み直していない実装だと、後から進んだ側も古い値を旧キーと思い込み、
        # 同じキーを 2 回積む（DELETE の方が先にロック待ちに並ぶので、この順になりやすい）。
        assert len(_queued_reasons(initial_key)) == 1, _queued_reasons(initial_key)
        if final_key is None:
            assert _queued_reasons(put_key) == ["avatar_deleted"]  # DELETE が後に効いた
        else:
            assert final_key == put_key  # PUT が後に効いた
            assert _queued_reasons(put_key) == []

    # どの場合も、最後に残ったキー以外はすべて削除キューに**ちょうど 1 回**載っている
    # ＝孤児なし・二重登録なし。
    for key in all_keys - {final_key}:
        reasons = _queued_reasons(key)
        assert reasons, f"{key} が誰にも指されず削除キューにも無い（孤児）"
        assert len(reasons) == 1, f"{key} が削除キューに二重に積まれている: {reasons}"
