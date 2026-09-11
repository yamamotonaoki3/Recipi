"""感想（コメント）の結合テスト（Issue #69 / features/comment.md）。

実 PostgreSQL ＋ 実 MinIO に対して実行する。

BB（仕様ベース）: 本文の境界値（前後の空白を除いてから 0 / 1 / 1000 / 1001 文字）、
権限の同値分割（感想の投稿者 / レシピ投稿者 / 第三者 / 未認証）、可視性、
`commentCount`、画像つき投稿、ページング。
WB（実装ベース）: `PATCH` の `imageKey` 4 分岐、編集ではカウント不変・通知なし、
レシピ削除で感想画像のキーが CASCADE より前に削除キューへ載ること、並行処理。

## 後始末

テストで作った画像キーは `keys` fixture に記録し、最後にオブジェクト・削除キューの行・
`uploads` 行を消して残数 0 を確かめる（non-functional.md のテストデータ規約）。
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
from sqlmodel import Session, delete, select, update

from app import storage
from app.db import engine
from app.models.notification import Notification
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.recipe import Recipe
from app.models.recipe_comment import RecipeComment
from app.models.upload import Upload
from tests.helpers import recipe_payload, signup, upload_image

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"
COMMENTS_URL = "/api/v1/comments"


# --- 道具 -----------------------------------------------------------------


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = str(body["user"]["id"])
        self.uuid = uuid.UUID(self.id)


@pytest.fixture
def keys() -> Iterator[list[str]]:
    """テストで作った画像キーを記録し、最後に片付ける。"""
    recorded: list[str] = []
    yield recorded
    with Session(engine) as s:
        for key in recorded:
            s.exec(delete(PendingStorageDeletion).where(PendingStorageDeletion.key == key))  # type: ignore[arg-type]
            s.exec(delete(Upload).where(Upload.key == key))  # type: ignore[arg-type]
            clear = update(RecipeComment).where(RecipeComment.image_key == key)  # type: ignore[arg-type]
            s.exec(clear.values(image_key=None))
        s.commit()
        for key in recorded:
            storage.delete_object(key)
            assert not storage.object_exists(key)
            assert s.exec(select(Upload).where(Upload.key == key)).first() is None


def _image(client: TestClient, user: _User, keys: list[str]) -> str:
    key = upload_image(client, user.headers)
    keys.append(key)
    return key


def _recipe(client: TestClient, owner: _User, *, public: bool = True) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(isPublic=public), headers=owner.headers)
    assert res.status_code == 201, res.text
    recipe_id: str = res.json()["id"]
    return recipe_id


def _post(
    client: TestClient,
    user: _User | None,
    recipe_id: str,
    body: str = "作りました！おいしかったです",
    image_key: str | None = None,
) -> Any:
    payload: dict[str, Any] = {"body": body}
    if image_key is not None:
        payload["imageKey"] = image_key
    headers = user.headers if user else {}
    return client.post(f"{RECIPES_URL}/{recipe_id}/comments", json=payload, headers=headers)


def _new_comment(client: TestClient, user: _User, recipe_id: str, **kw: Any) -> dict[str, Any]:
    res = _post(client, user, recipe_id, **kw)
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    return body


def _patch(client: TestClient, user: _User | None, comment_id: str, payload: dict[str, Any]) -> Any:
    headers = user.headers if user else {}
    return client.patch(f"{COMMENTS_URL}/{comment_id}", json=payload, headers=headers)


def _delete(client: TestClient, user: _User | None, comment_id: str) -> int:
    headers = user.headers if user else {}
    status: int = client.delete(f"{COMMENTS_URL}/{comment_id}", headers=headers).status_code
    return status


def _list(
    client: TestClient, viewer: _User | None, recipe_id: str, *, limit: int = 50
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    headers = viewer.headers if viewer else {}
    for _ in range(100):
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        res = client.get(f"{RECIPES_URL}/{recipe_id}/comments", params=params, headers=headers)
        assert res.status_code == 200, res.text
        page = res.json()
        items.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            break
    return items


def _count(recipe_id: str) -> int:
    with Session(engine) as s:
        recipe = s.get(Recipe, uuid.UUID(recipe_id))
        assert recipe is not None
        return recipe.comment_count


def _queued(key: str) -> list[str]:
    with Session(engine) as s:
        rows = s.exec(select(PendingStorageDeletion).where(PendingStorageDeletion.key == key)).all()
        return [r.reason for r in rows]


def _comment_image_key(comment_id: str) -> str | None:
    with Session(engine) as s:
        row = s.get(RecipeComment, uuid.UUID(comment_id))
        assert row is not None
        return row.image_key


# --- 本文の境界値 -------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "expected", "stored"),
    [
        ("", 400, None),  # 0 文字
        ("   ", 400, None),  # 空白だけ
        ("a", 201, "a"),  # 1 文字
        ("あ" * 1000, 201, "あ" * 1000),  # 1000 文字
        ("あ" * 1001, 400, None),  # 1001 文字
        ("  " + "あ" * 1000 + "  ", 201, "あ" * 1000),  # 前後の空白を除いてから数える
    ],
)
def test_body_boundaries(client: TestClient, body: str, expected: int, stored: str | None) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)

    res = _post(client, me, rid, body)

    assert res.status_code == expected, res.text
    if expected == 201:
        assert res.json()["body"] == stored
    else:
        assert _count(rid) == 0


# --- 権限（感想の投稿者 / レシピ投稿者 / 第三者 / 未認証） ----------------------


def test_recipe_owner_cannot_comment_on_own_recipe(client: TestClient) -> None:
    owner = _User(client)
    rid = _recipe(client, owner)
    assert _post(client, owner, rid).status_code == 403
    assert _count(rid) == 0


def test_others_can_comment_and_anonymous_cannot(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    assert _post(client, me, rid).status_code == 201
    assert _post(client, None, rid).status_code == 401


def test_same_user_can_write_multiple_comments(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    for i in range(3):
        _new_comment(client, me, rid, body=f"{i} 回目の感想")
    assert len(_list(client, me, rid)) == 3
    assert _count(rid) == 3


def test_only_the_comment_author_can_edit(client: TestClient) -> None:
    owner, author, third = _User(client), _User(client), _User(client)
    rid = _recipe(client, owner)
    cid = _new_comment(client, author, rid)["id"]

    assert _patch(client, owner, cid, {"body": "書き換え"}).status_code == 403
    assert _patch(client, third, cid, {"body": "書き換え"}).status_code == 403
    assert _patch(client, None, cid, {"body": "書き換え"}).status_code == 401
    res = _patch(client, author, cid, {"body": "本人が書き換え"})
    assert res.status_code == 200, res.text
    assert res.json()["body"] == "本人が書き換え"


def test_author_or_recipe_owner_can_delete(client: TestClient) -> None:
    owner, author, third = _User(client), _User(client), _User(client)
    rid = _recipe(client, owner)
    c1 = _new_comment(client, author, rid)["id"]
    c2 = _new_comment(client, author, rid)["id"]

    assert _delete(client, third, c1) == 403
    assert _delete(client, None, c1) == 401
    assert _delete(client, author, c1) == 204  # 感想の投稿者
    assert _delete(client, owner, c2) == 204  # レシピ投稿者（モデレーション）
    assert _count(rid) == 0


def test_unknown_comment_is_404(client: TestClient) -> None:
    me = _User(client)
    assert _patch(client, me, str(uuid.uuid4()), {"body": "x"}).status_code == 404
    assert _delete(client, me, str(uuid.uuid4())) == 404


# --- 可視性 ---------------------------------------------------------------------


def test_private_recipe_of_others_is_404(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner, public=False)

    assert _post(client, me, rid).status_code == 404
    res = client.get(f"{RECIPES_URL}/{rid}/comments", headers=me.headers)
    assert res.status_code == 404
    assert (
        client.get(f"{RECIPES_URL}/{uuid.uuid4()}/comments", headers=me.headers).status_code == 404
    )


def test_after_the_recipe_is_made_private(client: TestClient) -> None:
    """後から非公開化されたら、感想の投稿者でも 404。レシピ投稿者は一覧・削除できる。"""
    owner, author = _User(client), _User(client)
    rid = _recipe(client, owner)
    c1 = _new_comment(client, author, rid)["id"]
    c2 = _new_comment(client, author, rid)["id"]
    res = client.put(
        f"{RECIPES_URL}/{rid}", json=recipe_payload(isPublic=False), headers=owner.headers
    )
    assert res.status_code == 200, res.text

    assert client.get(f"{RECIPES_URL}/{rid}/comments", headers=author.headers).status_code == 404
    assert _patch(client, author, c1, {"body": "x"}).status_code == 404
    assert _delete(client, author, c1) == 404

    assert {c["id"] for c in _list(client, owner, rid)} == {c1, c2}
    assert _delete(client, owner, c1) == 204


def test_anonymous_can_read_public_recipe_comments(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    _new_comment(client, me, rid)
    assert len(_list(client, None, rid)) == 1


# --- カウントと通知 ---------------------------------------------------------------


def _notifications(owner: _User, recipe_id: str) -> list[Notification]:
    with Session(engine) as s:
        return list(
            s.exec(
                select(Notification).where(
                    Notification.user_id == owner.uuid,
                    Notification.recipe_id == uuid.UUID(recipe_id),
                    Notification.type == "recipe_commented",
                )
            ).all()
        )


def test_count_and_notification_follow_post_edit_delete(client: TestClient) -> None:
    """投稿で +1 と通知 1 件、編集ではどちらも変わらず、削除で −1 と通知も消える。"""
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)

    cid = _new_comment(client, me, rid)["id"]
    detail = client.get(f"{RECIPES_URL}/{rid}", headers=me.headers).json()
    assert detail["commentCount"] == 1
    rows = _notifications(owner, rid)
    assert len(rows) == 1
    assert rows[0].actor_id == me.uuid
    assert rows[0].comment_id == uuid.UUID(cid)

    assert _patch(client, me, cid, {"body": "編集しました"}).status_code == 200
    assert _count(rid) == 1
    assert len(_notifications(owner, rid)) == 1

    assert _delete(client, me, cid) == 204
    assert _count(rid) == 0
    assert _notifications(owner, rid) == []  # 感想が消えたら通知も消える（CASCADE）


# --- 画像 -------------------------------------------------------------------------


def test_post_with_image_shows_image_url(client: TestClient, keys: list[str]) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    key = _image(client, me, keys)

    created = _new_comment(client, me, rid, image_key=key)

    assert created["imageUrl"] and created["imageUrl"].endswith(key)
    listed = _list(client, None, rid)[0]
    assert listed["imageUrl"] == created["imageUrl"]
    assert listed["author"]["id"] == me.id
    assert "avatarUrl" in listed["author"]


def test_patch_image_key_four_branches(client: TestClient, keys: list[str]) -> None:
    """省略 = 維持 / 同じキー = 維持 / 新しいキー = 差し替え / null = 削除。"""
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    k1 = _image(client, me, keys)
    cid = _new_comment(client, me, rid, image_key=k1)["id"]

    # 1) 省略（本文だけ変える）→ 画像はそのまま
    assert _patch(client, me, cid, {"body": "本文だけ変更"}).status_code == 200
    assert _comment_image_key(cid) == k1
    # 2) 同じキーを再送 → 維持（消費処理を通さないので 400 にならない。削除キューにも載らない）
    assert _patch(client, me, cid, {"imageKey": k1}).status_code == 200
    assert _comment_image_key(cid) == k1
    assert _queued(k1) == []
    # 3) 新しいキー → 差し替え、旧キーが削除キューへ
    k2 = _image(client, me, keys)
    assert _patch(client, me, cid, {"imageKey": k2}).status_code == 200
    assert _comment_image_key(cid) == k2
    assert _queued(k1) == ["comment_image_replaced"]
    # 4) null → 画像を外し、旧キーが削除キューへ
    res = _patch(client, me, cid, {"imageKey": None})
    assert res.status_code == 200, res.text
    assert res.json()["imageUrl"] is None
    assert _queued(k2) == ["comment_image_removed"]


def test_invalid_image_keys_are_400(client: TestClient, keys: list[str]) -> None:
    """他人のキー・レシピで使用中のキー・別の感想のキーは 400。"""
    owner, me, other = _User(client), _User(client), _User(client)
    rid = _recipe(client, owner)
    cid = _new_comment(client, me, rid)["id"]

    others_key = _image(client, other, keys)
    assert _patch(client, me, cid, {"imageKey": others_key}).status_code == 400

    used_by_recipe = _image(client, me, keys)
    res = client.post(
        RECIPES_URL,
        json=recipe_payload(thumbnailKey=used_by_recipe),
        headers=me.headers,
    )
    assert res.status_code == 201, res.text
    assert _patch(client, me, cid, {"imageKey": used_by_recipe}).status_code == 400

    used_by_comment = _image(client, me, keys)
    _new_comment(client, me, rid, image_key=used_by_comment)
    assert _patch(client, me, cid, {"imageKey": used_by_comment}).status_code == 400
    assert _post(client, me, rid, image_key=used_by_comment).status_code == 400


def test_patch_needs_a_change_and_body_cannot_be_null(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    cid = _new_comment(client, me, rid)["id"]

    assert _patch(client, me, cid, {}).status_code == 400
    assert _patch(client, me, cid, {"body": None}).status_code == 400


def test_recipe_deletion_queues_comment_images(client: TestClient, keys: list[str]) -> None:
    """レシピ削除で感想も消え、感想画像のキーが削除キューに載る（CASCADE より前に集める）。"""
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    key = _image(client, me, keys)
    cid = _new_comment(client, me, rid, image_key=key)["id"]

    assert client.delete(f"{RECIPES_URL}/{rid}", headers=owner.headers).status_code == 204

    with Session(engine) as s:
        assert s.get(RecipeComment, uuid.UUID(cid)) is None
    assert _queued(key) == ["recipe_deleted"]


def test_openapi_body_is_optional_but_not_nullable(client: TestClient) -> None:
    """PATCH の body は「任意だが null は送れない」、imageKey は null（= 削除）を送れる。"""
    schema = client.get("/api/v1/openapi.json").json()["components"]["schemas"]
    update_req = schema["CommentUpdateRequest"]
    assert update_req.get("required", []) == []
    assert update_req["properties"]["body"].get("type") == "string"
    assert "anyOf" not in update_req["properties"]["body"]
    image_types = {t.get("type") for t in update_req["properties"]["imageKey"]["anyOf"]}
    assert image_types == {"string", "null"}


# --- 一覧 ---------------------------------------------------------------------------


def test_list_is_newest_first_and_paginates(client: TestClient) -> None:
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    ids = [_new_comment(client, me, rid, body=f"感想{i}")["id"] for i in range(3)]

    listed = _list(client, None, rid, limit=1)

    assert [c["id"] for c in listed] == list(reversed(ids))


def test_pagination_with_identical_created_at(client: TestClient) -> None:
    """作成日時がまったく同じ感想が並んでも、抜けも重複もなくたどれる（id で継ぐ）。"""
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    ids = {_new_comment(client, me, rid, body=f"同時刻{i}")["id"] for i in range(4)}
    same = datetime(2026, 1, 1, tzinfo=UTC)
    with Session(engine) as s:
        stmt = update(RecipeComment).where(RecipeComment.recipe_id == uuid.UUID(rid))  # type: ignore[arg-type]
        s.exec(stmt.values(created_at=same))
        s.commit()

    got = [c["id"] for c in _list(client, None, rid, limit=1)]

    assert len(got) == len(set(got)) == 4
    assert set(got) == ids


@pytest.mark.parametrize(("limit", "expected"), [("0", 400), ("1", 200), ("50", 200), ("51", 400)])
def test_limit_boundaries(client: TestClient, limit: str, expected: int) -> None:
    owner = _User(client)
    rid = _recipe(client, owner)
    res = client.get(f"{RECIPES_URL}/{rid}/comments", params={"limit": limit})
    assert res.status_code == expected, res.text


def test_malformed_cursor_returns_400(client: TestClient) -> None:
    owner = _User(client)
    rid = _recipe(client, owner)
    res = client.get(f"{RECIPES_URL}/{rid}/comments", params={"cursor": "not-base64!!"})
    assert res.status_code == 400, res.text


# --- 並行 ---------------------------------------------------------------------------


def test_concurrent_posts_keep_the_count_correct(client: TestClient) -> None:
    """5 人が同じレシピに同時に投稿しても、エラーなしで commentCount はちょうど 5。"""
    owner = _User(client)
    rid = _recipe(client, owner)
    writers = [_User(client) for _ in range(5)]
    statuses: list[int] = []
    guard = threading.Lock()

    def post(user: _User) -> None:
        status = _post(client, user, rid).status_code
        with guard:
            statuses.append(status)

    threads = [threading.Thread(target=post, args=(u,)) for u in writers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert statuses == [201] * 5, statuses
    assert _count(rid) == 5


def _lock_waiters(pattern: str) -> int:
    """指定のテーブルの行ロックを待っている接続の数（pg_stat_activity）。"""
    with engine.connect() as conn:
        count = conn.execute(
            text(
                """
                SELECT count(*) FROM pg_stat_activity
                WHERE pid <> pg_backend_pid() AND state = 'active'
                  AND wait_event_type = 'Lock' AND query ILIKE :pattern
                """
            ),
            {"pattern": pattern},
        ).scalar_one()
    return int(count)


def _wait_for_waiters(pattern: str, n: int) -> None:
    deadline = datetime.now(UTC) + timedelta(seconds=20)
    while _lock_waiters(pattern) < n and datetime.now(UTC) < deadline:
        threading.Event().wait(0.02)
    assert _lock_waiters(pattern) >= n, f"{n} 本がロック待ちに入らなかった"


def test_concurrent_image_replacements_leave_no_orphan(client: TestClient, keys: list[str]) -> None:
    """同じ感想の画像を 2 本の PATCH で同時に差し替えても、孤児も二重登録も残らない。

    テストが先に**レシピの行**をロックしておき、2 本の PATCH を投げる。どちらも
    レシピ行のロックで待つ（感想の書き込みは必ずレシピ → 感想の順にロックする）。
    2 本とも待ちに入ったのを確かめてから離すと、2 本目は必ず 1 本目のコミット後に進む。
    """
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    k0 = _image(client, me, keys)
    cid = _new_comment(client, me, rid, image_key=k0)["id"]
    ka, kb = _image(client, me, keys), _image(client, me, keys)
    statuses: list[int] = []
    guard = threading.Lock()

    def replace(key: str) -> None:
        status = _patch(client, me, cid, {"imageKey": key}).status_code
        with guard:
            statuses.append(status)

    lock_session = Session(engine)
    try:
        lock_session.exec(
            select(Recipe.id).where(Recipe.id == uuid.UUID(rid)).with_for_update(key_share=True)
        ).one()
        threads = [threading.Thread(target=replace, args=(k,)) for k in (ka, kb)]
        for t in threads:
            t.start()
        _wait_for_waiters("%FROM recipes%", 2)
    finally:
        lock_session.rollback()
        lock_session.close()
    for t in threads:
        t.join(timeout=30)

    assert statuses == [200, 200], statuses
    final = _comment_image_key(cid)
    assert final in (ka, kb)
    for key in {k0, ka, kb} - {final}:
        reasons = _queued(key)
        assert len(reasons) == 1, f"{key} の削除キュー登録が {reasons}（孤児か二重登録）"
    assert final is not None and _queued(final) == []


def test_recipe_deletion_and_comment_post_race(client: TestClient, keys: list[str]) -> None:
    """レシピ削除と画像つきの感想投稿が同時に来ても、どちらが先でも画像が取り残されない。

    - 投稿が先 → 削除がその感想画像のキーを削除キューに積む
    - 削除が先 → 投稿は 404 で、画像キーは消費されず `stored` のまま（GC の対象）
    """
    owner, me = _User(client), _User(client)
    rid = _recipe(client, owner)
    key = _image(client, me, keys)
    results: dict[str, int] = {}

    def post() -> None:
        results["post"] = _post(client, me, rid, image_key=key).status_code

    def remove() -> None:
        results["delete"] = client.delete(f"{RECIPES_URL}/{rid}", headers=owner.headers).status_code

    lock_session = Session(engine)
    try:
        lock_session.exec(
            select(Recipe.id).where(Recipe.id == uuid.UUID(rid)).with_for_update(key_share=True)
        ).one()
        threads = [threading.Thread(target=post), threading.Thread(target=remove)]
        for t in threads:
            t.start()
        _wait_for_waiters("%FROM recipes%", 2)
    finally:
        lock_session.rollback()
        lock_session.close()
    for t in threads:
        t.join(timeout=30)

    assert results["delete"] == 204, results
    with Session(engine) as s:
        upload = s.exec(select(Upload).where(Upload.key == key)).first()
    if results["post"] == 201:
        assert _queued(key) == ["recipe_deleted"]  # 削除が感想画像を拾った
    else:
        assert results["post"] == 404, results
        assert _queued(key) == []
        assert upload is not None and upload.status == "stored"  # 未使用のまま → GC が回収
