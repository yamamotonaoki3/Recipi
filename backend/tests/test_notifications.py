"""通知 API と新着レシピ通知の fan-out の結合テスト（Issue #70 / features/notification.md）。

BB（仕様ベース）: 4 種類の通知の形、自分あてだけ・新しい順・ページング、`limit` の境界、
未読数、既読化（ids あり / なし / 他人の ID / null）、削除・非公開化で見えなくなること、
公開レシピ投稿でフォロワー全員に届くこと。
WB（実装ベース）: outbox の状態遷移、二重配布の防止、BackgroundTasks の失敗とスイープ、
`SKIP LOCKED`、配布と非公開化・レシピ削除の競合。

テストデータは `testuser_` / `@example.com`。共有 DB なので、検証は自分が作った
ユーザーの通知だけで行う。users 行を直接消すテストは、消した後に相手のカウント列を
同じテスト内で直す（後続テストにずれを残さない）。
"""

from __future__ import annotations

import subprocess
import sys
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.db import engine
from app.jobs.notification_sweep import SWEEP_DELAY, sweep_outbox
from app.models.notification import Notification
from app.models.notification_outbox import NotificationOutbox
from app.models.recipe import Recipe
from app.models.user import User
from app.services import notification as notification_service
from tests.helpers import recipe_payload, signup

pytestmark = pytest.mark.integration

URL = "/api/v1/notifications"
RECIPES_URL = "/api/v1/recipes"
USERS_URL = "/api/v1/users"


# --- 道具 ---------------------------------------------------------------------


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = str(body["user"]["id"])
        self.uuid = uuid.UUID(self.id)


def _follow(client: TestClient, follower: _User, followee: _User) -> None:
    res = client.post(f"{USERS_URL}/{followee.id}/follow", headers=follower.headers)
    assert res.status_code == 204, res.text


def _recipe(client: TestClient, owner: _User, *, public: bool = True) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(isPublic=public), headers=owner.headers)
    assert res.status_code == 201, res.text
    rid: str = res.json()["id"]
    return rid


def _list_all(client: TestClient, user: _User, *, limit: int = 50) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(200):
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        res = client.get(URL, params=params, headers=user.headers)
        assert res.status_code == 200, res.text
        page = res.json()
        items.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            break
    return items


def _unread(client: TestClient, user: _User) -> int:
    res = client.get(f"{URL}/unread-count", headers=user.headers)
    assert res.status_code == 200, res.text
    count: int = res.json()["unreadCount"]
    return count


def _outbox(recipe_id: str) -> NotificationOutbox | None:
    with Session(engine) as s:
        return s.exec(
            select(NotificationOutbox).where(NotificationOutbox.recipe_id == uuid.UUID(recipe_id))
        ).first()


def _new_recipe_notifications(recipe_id: str) -> list[Notification]:
    with Session(engine) as s:
        return list(
            s.exec(
                select(Notification).where(
                    Notification.recipe_id == uuid.UUID(recipe_id),
                    Notification.type == "followee_new_recipe",
                )
            ).all()
        )


def _set_private(recipe_id: str, public: bool) -> None:
    with Session(engine) as s:
        s.exec(
            update(Recipe).where(col(Recipe.id) == uuid.UUID(recipe_id)).values(is_public=public)
        )
        s.commit()


def _reset_outbox(recipe_id: str) -> None:
    with Session(engine) as s:
        s.exec(
            update(NotificationOutbox)
            .where(col(NotificationOutbox.recipe_id) == uuid.UUID(recipe_id))
            .values(processed_at=None)
        )
        s.commit()


@pytest.fixture
def no_background_delivery(monkeypatch: pytest.MonkeyPatch) -> Callable[[uuid.UUID], None]:
    """BackgroundTasks の配布を止め（落ちた状況の再現）、本物の関数を返す。"""
    real = notification_service.deliver_outbox_for_recipe
    monkeypatch.setattr(notification_service, "deliver_outbox_for_recipe", lambda _rid: None)
    return real


def _delete_user_and_fix_counts(user_id: uuid.UUID, *, followees: list[uuid.UUID]) -> None:
    """users 行を直接消し、CASCADE で消えたフォローのぶん相手の follower_count を戻す。"""
    with Session(engine) as s:
        s.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        for fid in followees:
            s.execute(
                text("UPDATE users SET follower_count = follower_count - 1 WHERE id = :id"),
                {"id": fid},
            )
        s.commit()


# --- 4 種類の形 ------------------------------------------------------------------


def test_all_four_types_have_the_right_shape(client: TestClient) -> None:
    me, actor = _User(client), _User(client)
    _follow(client, actor, me)  # followed
    _follow(client, me, actor)
    my_recipe = _recipe(client, me)
    assert (
        client.post(f"{RECIPES_URL}/{my_recipe}/favorite", headers=actor.headers).status_code == 204
    )
    res = client.post(
        f"{RECIPES_URL}/{my_recipe}/comments", json={"body": "おいしかった"}, headers=actor.headers
    )
    assert res.status_code == 201, res.text
    comment_id = res.json()["id"]
    their_recipe = _recipe(client, actor)  # followee_new_recipe（me は actor をフォロー中）

    by_type = {n["type"]: n for n in _list_all(client, me)}

    assert set(by_type) == {
        "followed",
        "recipe_favorited",
        "recipe_commented",
        "followee_new_recipe",
    }
    for n in by_type.values():
        assert n["actor"]["id"] == actor.id
        assert set(n["actor"]) == {"id", "displayName", "avatarUrl"}
        assert n["readAt"] is None
        assert set(n) == {"id", "type", "readAt", "actor", "recipe", "comment", "createdAt"}
    assert by_type["followed"]["recipe"] is None and by_type["followed"]["comment"] is None
    assert by_type["recipe_favorited"]["recipe"]["id"] == my_recipe
    assert by_type["recipe_favorited"]["comment"] is None
    assert by_type["recipe_commented"]["recipe"]["id"] == my_recipe
    assert by_type["recipe_commented"]["comment"] == {"id": comment_id}
    assert by_type["followee_new_recipe"]["recipe"]["id"] == their_recipe
    assert by_type["followee_new_recipe"]["recipe"]["title"]


def test_only_my_notifications_newest_first(client: TestClient) -> None:
    me, other = _User(client), _User(client)
    fans = [_User(client) for _ in range(3)]
    for f in fans:
        _follow(client, f, me)
        _follow(client, f, other)

    mine = _list_all(client, me, limit=1)

    assert [n["actor"]["id"] for n in mine] == [f.id for f in reversed(fans)]
    assert {n["id"] for n in mine}.isdisjoint({n["id"] for n in _list_all(client, other)})


def test_pagination_with_identical_created_at(client: TestClient) -> None:
    me = _User(client)
    for _ in range(4):
        _follow(client, _User(client), me)
    same = datetime(2026, 1, 1, tzinfo=UTC)
    with Session(engine) as s:
        s.exec(
            update(Notification).where(col(Notification.user_id) == me.uuid).values(created_at=same)
        )
        s.commit()

    got = [n["id"] for n in _list_all(client, me, limit=1)]

    assert len(got) == len(set(got)) == 4


def test_default_limit_is_20_and_unread_counts_all(client: TestClient) -> None:
    """1 ページ（既定 20 件）に収まらない未読も、未読数には全件入る。"""
    me = _User(client)
    for _ in range(25):
        _follow(client, _User(client), me)

    page = client.get(URL, headers=me.headers).json()

    assert len(page["items"]) == 20
    assert page["nextCursor"] is not None
    assert page["unreadCount"] == 25 == _unread(client, me)


@pytest.mark.parametrize(("limit", "expected"), [("0", 400), ("1", 200), ("50", 200), ("51", 400)])
def test_limit_boundaries(client: TestClient, limit: str, expected: int) -> None:
    me = _User(client)
    assert client.get(URL, params={"limit": limit}, headers=me.headers).status_code == expected


def test_malformed_cursor_and_anonymous(client: TestClient) -> None:
    me = _User(client)
    assert client.get(URL, params={"cursor": "not-base64!!"}, headers=me.headers).status_code == 400
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/unread-count").status_code == 401
    assert client.post(f"{URL}/read").status_code == 401


# --- 既読化 -------------------------------------------------------------------------


def _read_at(notification_id: str) -> datetime | None:
    with Session(engine) as s:
        n = s.get(Notification, uuid.UUID(notification_id))
        assert n is not None
        return n.read_at


def test_mark_read_with_ids_only_touches_my_ids(client: TestClient) -> None:
    me, other = _User(client), _User(client)
    for _ in range(3):
        _follow(client, _User(client), me)
    _follow(client, _User(client), other)
    mine = [n["id"] for n in _list_all(client, me)]
    theirs = _list_all(client, other)[0]["id"]

    res = client.post(
        f"{URL}/read",
        json={"ids": [mine[0], theirs, str(uuid.uuid4())]},  # 他人の ID ・存在しない ID を混ぜる
        headers=me.headers,
    )

    assert res.status_code == 204, res.text
    assert _read_at(mine[0]) is not None
    assert _read_at(mine[1]) is None
    assert _read_at(theirs) is None
    assert _unread(client, me) == 2
    assert _unread(client, other) == 1


def test_mark_read_without_ids_reads_all(client: TestClient) -> None:
    payloads: list[dict[str, Any] | None] = [None, {}]
    for payload in payloads:
        me = _User(client)
        for _ in range(2):
            _follow(client, _User(client), me)
        if payload is None:
            res = client.post(f"{URL}/read", headers=me.headers)
        else:
            res = client.post(f"{URL}/read", json=payload, headers=me.headers)
        assert res.status_code == 204, res.text
        assert _unread(client, me) == 0


def test_mark_read_keeps_the_first_read_at(client: TestClient) -> None:
    me = _User(client)
    _follow(client, _User(client), me)
    nid = _list_all(client, me)[0]["id"]
    client.post(f"{URL}/read", json={"ids": [nid]}, headers=me.headers)
    first = _read_at(nid)

    client.post(f"{URL}/read", headers=me.headers)

    assert _read_at(nid) == first


@pytest.mark.parametrize(
    "body",
    [
        "null",  # body が null だけ
        '{"ids": null}',
        '{"ids": ["not-a-uuid"]}',
        '{"ids": [' + ",".join(f'"{uuid.uuid4()}"' for _ in range(101)) + "]}",  # 101 件
    ],
)
def test_mark_read_rejects_bad_bodies(client: TestClient, body: str) -> None:
    me = _User(client)
    _follow(client, _User(client), me)

    res = client.post(
        f"{URL}/read",
        content=body,
        headers={**me.headers, "Content-Type": "application/json"},
    )

    assert res.status_code == 400, res.text
    assert _unread(client, me) == 1  # 何も既読になっていない


def test_mark_read_accepts_100_ids_and_empty_list(client: TestClient) -> None:
    me = _User(client)
    _follow(client, _User(client), me)
    ids = [str(uuid.uuid4()) for _ in range(100)]
    assert client.post(f"{URL}/read", json={"ids": ids}, headers=me.headers).status_code == 204
    assert client.post(f"{URL}/read", json={"ids": []}, headers=me.headers).status_code == 204
    assert _unread(client, me) == 1


# --- 削除・非公開化 -------------------------------------------------------------------


def test_deleted_recipe_and_comment_remove_notifications(client: TestClient) -> None:
    me, actor = _User(client), _User(client)
    rid = _recipe(client, me)
    cid = client.post(
        f"{RECIPES_URL}/{rid}/comments", json={"body": "感想"}, headers=actor.headers
    ).json()["id"]
    rid2 = _recipe(client, me)
    client.post(f"{RECIPES_URL}/{rid2}/favorite", headers=actor.headers)
    assert len(_list_all(client, me)) == 2

    assert client.delete(f"/api/v1/comments/{cid}", headers=actor.headers).status_code == 204
    assert client.delete(f"{RECIPES_URL}/{rid2}", headers=me.headers).status_code == 204

    assert _list_all(client, me) == []
    with Session(engine) as s:  # 一覧から消えるだけでなく、行そのものが無い
        assert s.exec(select(Notification).where(Notification.user_id == me.uuid)).all() == []


def test_deleted_actor_and_recipient_remove_notifications(client: TestClient) -> None:
    me, actor = _User(client), _User(client)
    _follow(client, actor, me)
    assert len(_list_all(client, me)) == 1

    _delete_user_and_fix_counts(actor.uuid, followees=[me.uuid])

    assert _list_all(client, me) == []

    recipient, fan = _User(client), _User(client)
    _follow(client, fan, recipient)
    with Session(engine) as s:
        s.execute(text("DELETE FROM users WHERE id = :id"), {"id": recipient.uuid})
        s.execute(
            text("UPDATE users SET following_count = following_count - 1 WHERE id = :id"),
            {"id": fan.uuid},
        )
        s.commit()
        assert (
            s.exec(select(Notification).where(Notification.user_id == recipient.uuid)).all() == []
        )


def test_private_recipe_notifications_hidden_from_others_only(client: TestClient) -> None:
    """他人のレシピが非公開になると通知は隠れ、公開に戻ると戻る。自分のレシピなら見える。"""
    me, author = _User(client), _User(client)
    _follow(client, me, author)
    rid = _recipe(client, author)  # me に followee_new_recipe
    mine = _recipe(client, me)
    client.post(f"{RECIPES_URL}/{mine}/favorite", headers=author.headers)
    assert _unread(client, me) == 2

    _set_private(rid, False)
    _set_private(mine, False)

    listed = _list_all(client, me)
    assert [n["recipe"]["id"] for n in listed] == [mine]  # 自分の非公開レシピの通知は見える
    assert _unread(client, me) == 1

    _set_private(rid, True)
    assert _unread(client, me) == 2


# --- fan-out ------------------------------------------------------------------------


def test_public_recipe_reaches_all_followers(client: TestClient) -> None:
    author, stranger = _User(client), _User(client)
    fans = [_User(client) for _ in range(2)]
    for f in fans:
        _follow(client, f, author)

    rid = _recipe(client, author)

    got = {n.user_id for n in _new_recipe_notifications(rid)}
    assert got == {f.uuid for f in fans}
    assert stranger.uuid not in got and author.uuid not in got
    outbox = _outbox(rid)
    assert outbox is not None and outbox.processed_at is not None


def test_private_recipe_creates_no_outbox_even_after_publishing(client: TestClient) -> None:
    author, fan = _User(client), _User(client)
    _follow(client, fan, author)

    rid = _recipe(client, author, public=False)
    assert _outbox(rid) is None
    res = client.put(
        f"{RECIPES_URL}/{rid}", json=recipe_payload(isPublic=True), headers=author.headers
    )
    assert res.status_code == 200, res.text

    assert _outbox(rid) is None
    assert _new_recipe_notifications(rid) == []


def test_zero_followers_still_marks_processed(client: TestClient) -> None:
    author = _User(client)
    rid = _recipe(client, author)
    outbox = _outbox(rid)
    assert outbox is not None and outbox.processed_at is not None
    assert _new_recipe_notifications(rid) == []


def test_double_delivery_does_not_duplicate(client: TestClient) -> None:
    author, fan = _User(client), _User(client)
    _follow(client, fan, author)
    rid = _recipe(client, author)

    _reset_outbox(rid)
    notification_service.deliver_outbox_for_recipe(uuid.UUID(rid))

    assert len(_new_recipe_notifications(rid)) == 1


def test_outbox_constraints(client: TestClient) -> None:
    author = _User(client)
    rid = _recipe(client, author)
    with Session(engine) as s:  # 1 レシピ 1 行
        s.add(
            NotificationOutbox(
                event="followee_new_recipe", recipe_id=uuid.UUID(rid), author_id=author.uuid
            )
        )
        with pytest.raises(IntegrityError):
            s.commit()
    with Session(engine) as s:  # NOT NULL
        with pytest.raises(IntegrityError):
            s.execute(
                text(
                    "INSERT INTO notification_outbox (id, event, recipe_id, author_id, created_at) "
                    "VALUES (gen_random_uuid(), 'followee_new_recipe', NULL, :a, now())"
                ),
                {"a": author.uuid},
            )


def test_outbox_cascades_with_recipe_and_author(client: TestClient) -> None:
    author = _User(client)
    rid = _recipe(client, author)
    assert client.delete(f"{RECIPES_URL}/{rid}", headers=author.headers).status_code == 204
    assert _outbox(rid) is None

    author2 = _User(client)
    rid2 = _recipe(client, author2)
    with Session(engine) as s:
        s.execute(text("DELETE FROM users WHERE id = :id"), {"id": author2.uuid})
        s.commit()
    assert _outbox(rid2) is None


def test_background_failure_is_recovered_by_sweep(
    client: TestClient, no_background_delivery: Callable[[uuid.UUID], None]
) -> None:
    """配布が落ちても outbox は残り、スイープが配る。受信者は配布した時点のフォロワー。"""
    author, early, late, leaver = _User(client), _User(client), _User(client), _User(client)
    _follow(client, early, author)
    _follow(client, leaver, author)

    rid = _recipe(client, author)
    outbox = _outbox(rid)
    assert outbox is not None and outbox.processed_at is None
    assert _new_recipe_notifications(rid) == []

    _follow(client, late, author)
    assert (
        client.delete(f"{USERS_URL}/{author.id}/follow", headers=leaver.headers).status_code == 204
    )

    # 5 分たつ前は拾わない。ちょうど 5 分で拾う。
    sweep_outbox(now=outbox.created_at + SWEEP_DELAY - timedelta(seconds=1))
    assert _new_recipe_notifications(rid) == []
    sweep_outbox(now=outbox.created_at + SWEEP_DELAY)

    got = {n.user_id for n in _new_recipe_notifications(rid)}
    assert got == {early.uuid, late.uuid}
    after = _outbox(rid)
    assert after is not None and after.processed_at is not None
    # 通知の時刻は配った時刻ではなく、投稿した時刻。
    assert all(n.created_at == outbox.created_at for n in _new_recipe_notifications(rid))


def test_sweep_continues_after_one_failure(
    client: TestClient,
    no_background_delivery: Callable[[uuid.UUID], None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    author, fan = _User(client), _User(client)
    _follow(client, fan, author)
    bad, good = _recipe(client, author), _recipe(client, author)
    bad_outbox = _outbox(bad)
    assert bad_outbox is not None
    real = notification_service.deliver_one

    def flaky(session: Session, outbox_id: uuid.UUID) -> bool:
        if outbox_id == bad_outbox.id:
            raise RuntimeError("配布失敗の再現")
        return real(session, outbox_id)

    monkeypatch.setattr("app.jobs.notification_sweep.deliver_one", flaky)
    sweep_outbox(now=datetime.now(UTC) + timedelta(hours=1))

    assert len(_new_recipe_notifications(good)) == 1
    assert _new_recipe_notifications(bad) == []
    still = _outbox(bad)
    assert still is not None and still.processed_at is None


def test_sweep_command_runs() -> None:
    res = subprocess.run(
        [sys.executable, "-m", "app.jobs.notification_sweep"], capture_output=True, timeout=120
    )
    assert res.returncode == 0, res.stderr.decode(errors="replace")


# --- 並行 ---------------------------------------------------------------------------


def _lock_waiters(pattern: str) -> int:
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


def _wait_for_waiter(pattern: str) -> None:
    deadline = datetime.now(UTC) + timedelta(seconds=20)
    while _lock_waiters(pattern) < 1 and datetime.now(UTC) < deadline:
        threading.Event().wait(0.02)
    assert _lock_waiters(pattern) >= 1, "配布がロック待ちに入らなかった"


def test_skip_locked_leaves_rows_being_processed(
    client: TestClient, no_background_delivery: Callable[[uuid.UUID], None]
) -> None:
    """他が outbox 行を処理中なら、スイープも BackgroundTasks も待たずに飛ばす。"""
    author, fan = _User(client), _User(client)
    _follow(client, fan, author)
    rid = _recipe(client, author)
    outbox = _outbox(rid)
    assert outbox is not None

    with Session(engine) as holder:
        holder.execute(
            text("SELECT id FROM notification_outbox WHERE id = :id FOR UPDATE"), {"id": outbox.id}
        )
        sweep_outbox(now=datetime.now(UTC) + timedelta(hours=1))
        no_background_delivery(uuid.UUID(rid))
        assert _new_recipe_notifications(rid) == []
        holder.rollback()

    sweep_outbox(now=datetime.now(UTC) + timedelta(hours=1))
    assert len(_new_recipe_notifications(rid)) == 1


def _run_delivery_while_holding_recipe(
    rid: str, deliver: Callable[[uuid.UUID], None], then: Callable[[Session], None]
) -> None:
    """テストが recipes 行をロックしたまま配布を別スレッドで起動し、待ちに入ってから `then`。"""
    errors: list[BaseException] = []

    def run() -> None:
        try:
            deliver(uuid.UUID(rid))
        except BaseException as exc:  # noqa: BLE001  スレッド内の失敗を親へ渡す
            errors.append(exc)

    with Session(engine) as holder:
        holder.execute(
            text("SELECT id FROM recipes WHERE id = :id FOR NO KEY UPDATE"), {"id": uuid.UUID(rid)}
        )
        thread = threading.Thread(target=run)
        thread.start()
        try:
            _wait_for_waiter("%FROM recipes WHERE id = % FOR SHARE%")
            then(holder)
            holder.commit()
        finally:
            if holder.in_transaction():
                holder.rollback()
        thread.join(timeout=30)
    assert not thread.is_alive()
    if errors:
        raise errors[0]


def test_privatized_during_delivery_is_not_delivered(
    client: TestClient, no_background_delivery: Callable[[uuid.UUID], None]
) -> None:
    """配布がレシピのロックを待っている間に非公開化がコミットされたら、配らない。"""
    author, fan = _User(client), _User(client)
    _follow(client, fan, author)
    rid = _recipe(client, author)

    def privatize(holder: Session) -> None:
        holder.execute(
            text("UPDATE recipes SET is_public = false WHERE id = :id"), {"id": uuid.UUID(rid)}
        )

    _run_delivery_while_holding_recipe(rid, no_background_delivery, privatize)

    assert _new_recipe_notifications(rid) == []
    outbox = _outbox(rid)
    assert outbox is not None and outbox.processed_at is not None
    _set_private(rid, True)  # 後で公開に戻しても配らない
    sweep_outbox(now=datetime.now(UTC) + timedelta(hours=1))
    assert _new_recipe_notifications(rid) == []


def test_recipe_deleted_during_delivery(
    client: TestClient, no_background_delivery: Callable[[uuid.UUID], None]
) -> None:
    """配布がレシピのロックを待っている間にレシピが削除されても、エラーにもデッドロックにもならない。"""
    author, fan = _User(client), _User(client)
    _follow(client, fan, author)
    rid = _recipe(client, author)

    def delete_recipe(holder: Session) -> None:
        holder.execute(text("DELETE FROM recipes WHERE id = :id"), {"id": uuid.UUID(rid)})

    _run_delivery_while_holding_recipe(rid, no_background_delivery, delete_recipe)

    assert _outbox(rid) is None
    assert _new_recipe_notifications(rid) == []
    with Session(engine) as s:
        assert s.get(User, fan.uuid) is not None


# --- OpenAPI ------------------------------------------------------------------------


def test_openapi_contract(client: TestClient) -> None:
    spec = client.get("/api/v1/openapi.json").json()
    paths = spec["paths"]
    assert set(paths[f"{URL}"]["get"]["responses"]) >= {"200", "400", "401"}
    assert set(paths[f"{URL}/unread-count"]["get"]["responses"]) >= {"200", "401"}
    assert set(paths[f"{URL}/read"]["post"]["responses"]) >= {"204", "400", "401"}
    body_schema = paths[f"{URL}/read"]["post"]["requestBody"]["content"]["application/json"]
    assert body_schema["schema"] == {"$ref": "#/components/schemas/MarkReadRequest"}  # null 不可
    mark = spec["components"]["schemas"]["MarkReadRequest"]
    assert mark.get("required", []) == []
    assert "anyOf" not in mark["properties"]["ids"]
    assert mark["properties"]["ids"]["maxItems"] == 100
