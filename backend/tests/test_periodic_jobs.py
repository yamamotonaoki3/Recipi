"""定期ジョブ（Issue #72）の結合テスト。

対象: cleanup_refresh_tokens / cleanup_notifications / trim_recipe_views、recount_counts（4 列）。

BB（仕様ベース）: 保持期間ちょうど / 1 秒手前 / 1 秒後、上限件数ちょうど / +1 / +3、
未読・未処理は残る、有効なトークンは残る、コマンドとして 0 終了する。
WB（実装ベース）: 対象あり / なし、BATCH_SIZE を超える件数での複数バッチ、
SKIP LOCKED（他がロック中の行を飛ばす）、閲覧履歴の同一ユーザー排他と、削除中に
更新された行を消さないこと、設定値がジョブに実際に効いていること。

## 共有 DB での注意

ジョブは全ユーザーが対象。テストで作る「消える行」は自分のユーザーのものだけで、
`now` は現在時刻を使う（遠い未来の `now` を渡して他のテストの行まで消さない）。
作ったユーザーは `users` fixture が最後に消す（CASCADE で関連行も消える）。
"""

from __future__ import annotations

import subprocess
import sys
import threading
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.jobs import recount_counts
from app.jobs.cleanup_notifications import cleanup_notifications
from app.jobs.cleanup_refresh_tokens import cleanup_refresh_tokens
from app.jobs.trim_recipe_views import trim_recipe_views
from app.security import hash_refresh_token
from tests.helpers import recipe_payload, signup

pytestmark = pytest.mark.integration


class _User:
    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.refresh_token: str = body["refreshToken"]
        self.id = str(body["user"]["id"])
        self.uuid = uuid.UUID(self.id)


@pytest.fixture
def users(client: TestClient) -> Iterator[Any]:
    """ユーザーを作る関数を返し、テストの最後に作った全員を消す（失敗しても消す）。"""
    made: list[uuid.UUID] = []

    def make() -> _User:
        u = _User(client)
        made.append(u.uuid)
        return u

    try:
        yield make
    finally:
        with Session(engine) as s:
            s.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": made})
            s.commit()
            left = s.execute(
                text("SELECT count(*) FROM users WHERE id = ANY(:ids)"), {"ids": made}
            ).scalar_one()
        assert left == 0


def _exec(sql: str, **params: Any) -> None:
    with Session(engine) as s:
        s.execute(text(sql), params)
        s.commit()


def _scalar(sql: str, **params: Any) -> Any:
    with Session(engine) as s:
        return s.execute(text(sql), params).scalar_one()


def _run(fn: Any, *args: Any, **kwargs: Any) -> Any:
    with Session(engine) as s:
        return fn(s, *args, **kwargs)


# --- リフレッシュトークン ------------------------------------------------------


def _expire_chain_of(user: _User, expires_at: datetime) -> None:
    _exec("UPDATE refresh_tokens SET expires_at = :e WHERE user_id = :u", e=expires_at, u=user.uuid)


def _tokens_of(user: _User) -> int:
    return int(_scalar("SELECT count(*) FROM refresh_tokens WHERE user_id = :u", u=user.uuid))


@pytest.mark.parametrize("retention_days", [None, 3])
def test_refresh_token_retention_boundaries(
    users: Any, monkeypatch: pytest.MonkeyPatch, retention_days: int | None
) -> None:
    """チェーンの最後の期限 + 保持日数ちょうど・1 秒後は消え、1 秒手前は残る。

    `retention_days=3` は設定を既定値と違う値にして、ジョブが設定を読んでいる
    ことを確かめる（30 日をハードコードした実装なら落ちる）。
    """
    if retention_days is not None:
        monkeypatch.setattr(settings, "REFRESH_TOKEN_EXPIRED_RETENTION_DAYS", retention_days)
    days = settings.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    exact, before, after, alive = users(), users(), users(), users()
    _expire_chain_of(exact, cutoff)
    _expire_chain_of(before, cutoff + timedelta(seconds=1))
    _expire_chain_of(after, cutoff - timedelta(seconds=1))

    _run(cleanup_refresh_tokens, now=now)

    assert _tokens_of(exact) == 0
    assert _tokens_of(after) == 0
    assert _tokens_of(before) == 1
    assert _tokens_of(alive) == 1  # 有効なトークンは残る


def test_chain_with_live_token_is_kept_and_reuse_still_detected(
    client: TestClient, users: Any
) -> None:
    """古い失効済みトークンがあっても、チェーンに生きたトークンがあれば 1 行も消さない。"""
    me = users()
    old_raw = me.refresh_token
    res = client.post("/api/v1/auth/refresh", json={"refreshToken": old_raw})
    assert res.status_code == 200, res.text
    # 古い（使用済みの）トークンだけ、ずっと昔に期限切れにする。
    _exec(
        "UPDATE refresh_tokens SET expires_at = :e WHERE token_hash = :h",
        e=datetime.now(UTC) - timedelta(days=400),
        h=hash_refresh_token(old_raw),
    )

    _run(cleanup_refresh_tokens)

    assert _tokens_of(me) == 2
    # 古いトークンを出すと再利用検知でチェーン全体が失効する（証拠が残っている）。
    reuse = client.post("/api/v1/auth/refresh", json={"refreshToken": old_raw})
    assert reuse.status_code == 401
    live = _scalar(
        "SELECT count(*) FROM refresh_tokens WHERE user_id = :u AND revoked_at IS NULL", u=me.uuid
    )
    assert live == 0


def test_refresh_tokens_multiple_batches_and_skip_locked(users: Any) -> None:
    now = datetime.now(UTC)
    old = now - timedelta(days=settings.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS + 1)
    group = [users() for _ in range(5)]
    for u in group:
        _expire_chain_of(u, old)
    locked_user = group[0]

    with Session(engine) as holder:
        holder.execute(
            text("SELECT id FROM refresh_tokens WHERE user_id = :u FOR UPDATE"),
            {"u": locked_user.uuid},
        )
        _run(cleanup_refresh_tokens, now=now, batch_size=2)  # 待たずに返る
        holder.rollback()

    assert _tokens_of(locked_user) == 1  # ロック中の行は飛ばした
    assert all(_tokens_of(u) == 0 for u in group[1:])  # 複数バッチで全部消えた
    _run(cleanup_refresh_tokens, now=now, batch_size=2)
    assert _tokens_of(locked_user) == 0


def test_one_long_chain_is_deleted_across_batches(client: TestClient, users: Any) -> None:
    """1 つのチェーンに BATCH_SIZE を超える行があっても、行単位のバッチで全部消える。"""
    me = users()
    raw = me.refresh_token
    for _ in range(4):  # ローテーション 4 回 → 同じチェーンに 5 行
        res = client.post("/api/v1/auth/refresh", json={"refreshToken": raw})
        assert res.status_code == 200, res.text
        raw = res.json()["refreshToken"]
    assert _tokens_of(me) == 5
    now = datetime.now(UTC)
    # 1 行だけまだ新しいと、チェーンは 1 行も消えない。
    _expire_chain_of(me, now - timedelta(days=settings.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS + 1))
    _exec(
        "UPDATE refresh_tokens SET expires_at = :e WHERE token_hash = :h",
        e=now + timedelta(days=1),
        h=hash_refresh_token(raw),
    )
    _run(cleanup_refresh_tokens, now=now, batch_size=2)
    assert _tokens_of(me) == 5

    _expire_chain_of(me, now - timedelta(days=settings.REFRESH_TOKEN_EXPIRED_RETENTION_DAYS + 1))
    _run(cleanup_refresh_tokens, now=now, batch_size=2)
    assert _tokens_of(me) == 0


def test_refresh_race_with_cleanup_is_401(
    client: TestClient, users: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """refresh がトークンを読んだ後・ロックする前に掃除が行を消しても、500 ではなく 401。"""
    from app.models.user import User

    me = users()
    original_get = Session.get

    def get_after_cleanup(self: Session, entity: Any, ident: Any, **kwargs: Any) -> Any:
        if entity is User and kwargs.get("with_for_update"):
            _exec("DELETE FROM refresh_tokens WHERE user_id = :u", u=me.uuid)
        return original_get(self, entity, ident, **kwargs)

    monkeypatch.setattr(Session, "get", get_after_cleanup)
    res = client.post("/api/v1/auth/refresh", json={"refreshToken": me.refresh_token})
    assert res.status_code == 401, res.text


# --- 通知・outbox ----------------------------------------------------------------


def _notifications_for(client: TestClient, users: Any, target: _User, n: int) -> list[str]:
    for _ in range(n):
        fan = users()
        assert (
            client.post(f"/api/v1/users/{target.id}/follow", headers=fan.headers).status_code == 204
        )
    with Session(engine) as s:
        rows = s.execute(
            text("SELECT id FROM notifications WHERE user_id = :u ORDER BY created_at"),
            {"u": target.uuid},
        ).all()
    return [str(r[0]) for r in rows]


def _exists(table: str, row_id: str) -> bool:
    return bool(_scalar(f"SELECT count(*) FROM {table} WHERE id = :i", i=uuid.UUID(row_id)))


@pytest.mark.parametrize("retention_days", [None, 10])
def test_read_notification_retention_boundaries(
    client: TestClient, users: Any, monkeypatch: pytest.MonkeyPatch, retention_days: int | None
) -> None:
    if retention_days is not None:
        monkeypatch.setattr(settings, "NOTIFICATION_READ_RETENTION_DAYS", retention_days)
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=settings.NOTIFICATION_READ_RETENTION_DAYS)
    target = users()
    exact, before, after, unread = _notifications_for(client, users, target, 4)
    for nid, read_at in (
        (exact, cutoff),
        (before, cutoff + timedelta(seconds=1)),
        (after, cutoff - timedelta(seconds=1)),
    ):
        _exec("UPDATE notifications SET read_at = :r WHERE id = :i", r=read_at, i=uuid.UUID(nid))
    # 未読は 1 年前に作られたものでも残す。
    _exec(
        "UPDATE notifications SET created_at = :c WHERE id = :i",
        c=now - timedelta(days=365),
        i=uuid.UUID(unread),
    )

    _run(cleanup_notifications, now=now)

    assert not _exists("notifications", exact)
    assert not _exists("notifications", after)
    assert _exists("notifications", before)
    assert _exists("notifications", unread)


@pytest.mark.parametrize("retention_days", [None, 2])
def test_processed_outbox_retention_boundaries(
    client: TestClient, users: Any, monkeypatch: pytest.MonkeyPatch, retention_days: int | None
) -> None:
    if retention_days is not None:
        monkeypatch.setattr(settings, "OUTBOX_PROCESSED_RETENTION_DAYS", retention_days)
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=settings.OUTBOX_PROCESSED_RETENTION_DAYS)
    author = users()
    ids: list[str] = []
    for _ in range(4):
        rid = client.post("/api/v1/recipes", json=recipe_payload(), headers=author.headers).json()[
            "id"
        ]
        ids.append(
            str(
                _scalar("SELECT id FROM notification_outbox WHERE recipe_id = :r", r=uuid.UUID(rid))
            )
        )
    exact, before, after, unprocessed = ids
    for oid, processed in (
        (exact, cutoff),
        (before, cutoff + timedelta(seconds=1)),
        (after, cutoff - timedelta(seconds=1)),
    ):
        _exec(
            "UPDATE notification_outbox SET processed_at = :p WHERE id = :i",
            p=processed,
            i=uuid.UUID(oid),
        )
    _exec(
        "UPDATE notification_outbox SET processed_at = NULL, created_at = :c WHERE id = :i",
        c=now - timedelta(days=365),
        i=uuid.UUID(unprocessed),
    )

    _run(cleanup_notifications, now=now)

    assert not _exists("notification_outbox", exact)
    assert not _exists("notification_outbox", after)
    assert _exists("notification_outbox", before)
    assert _exists("notification_outbox", unprocessed)  # 未処理は残す


def test_hidden_read_notification_is_also_deleted_after_retention(
    client: TestClient, users: Any
) -> None:
    """非公開化で一覧から隠れている既読通知も、保持期間を過ぎたら消す（Issue #72 で決定）。"""
    now = datetime.now(UTC)
    old = now - timedelta(days=settings.NOTIFICATION_READ_RETENTION_DAYS + 1)
    author, fan = users(), users()
    assert client.post(f"/api/v1/users/{author.id}/follow", headers=fan.headers).status_code == 204
    rid = client.post("/api/v1/recipes", json=recipe_payload(), headers=author.headers).json()["id"]
    nid = str(
        _scalar(
            "SELECT id FROM notifications WHERE user_id = :u AND recipe_id = :r",
            u=fan.uuid,
            r=uuid.UUID(rid),
        )
    )
    _exec("UPDATE notifications SET read_at = :r WHERE id = :i", r=old, i=uuid.UUID(nid))
    _exec("UPDATE recipes SET is_public = false WHERE id = :r", r=uuid.UUID(rid))

    _run(cleanup_notifications, now=now)

    assert not _exists("notifications", nid)


def test_notifications_multiple_batches_and_skip_locked(client: TestClient, users: Any) -> None:
    now = datetime.now(UTC)
    old = now - timedelta(days=settings.NOTIFICATION_READ_RETENTION_DAYS + 1)
    target = users()
    ids = _notifications_for(client, users, target, 5)
    _exec("UPDATE notifications SET read_at = :r WHERE user_id = :u", r=old, u=target.uuid)

    with Session(engine) as holder:
        holder.execute(
            text("SELECT id FROM notifications WHERE id = :i FOR UPDATE"), {"i": uuid.UUID(ids[0])}
        )
        _run(cleanup_notifications, now=now, batch_size=2)
        holder.rollback()

    assert _exists("notifications", ids[0])
    assert not any(_exists("notifications", i) for i in ids[1:])
    _run(cleanup_notifications, now=now, batch_size=2)
    assert not _exists("notifications", ids[0])


# --- 閲覧履歴 --------------------------------------------------------------------


MAX_VIEWS = 5  # テストでは上限を小さくする（設定がジョブに効いていることの確認も兼ねる）


@pytest.fixture
def small_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "RECIPE_VIEWS_MAX_PER_USER", MAX_VIEWS)


def _viewer_with(client: TestClient, users: Any, count: int) -> tuple[_User, list[str]]:
    """`count` 件の閲覧履歴を持つユーザーを作る（古い順に 1 分ずつ新しい時刻）。"""
    owner, viewer = users(), users()
    recipes: list[str] = []
    base = datetime.now(UTC) - timedelta(days=1)
    for i in range(count):
        rid = client.post(
            "/api/v1/recipes", json=recipe_payload(isPublic=True), headers=owner.headers
        ).json()["id"]
        assert client.post(f"/api/v1/recipes/{rid}/view", headers=viewer.headers).status_code == 204
        _exec(
            "UPDATE recipe_views SET viewed_at = :v WHERE user_id = :u AND recipe_id = :r",
            v=base + timedelta(minutes=i),
            u=viewer.uuid,
            r=uuid.UUID(rid),
        )
        recipes.append(rid)
    return viewer, recipes


def _views_of(user: _User) -> set[str]:
    with Session(engine) as s:
        rows = s.execute(
            text("SELECT recipe_id FROM recipe_views WHERE user_id = :u"), {"u": user.uuid}
        ).all()
    return {str(r[0]) for r in rows}


@pytest.mark.parametrize(
    ("count", "removed"), [(MAX_VIEWS, 0), (MAX_VIEWS + 1, 1), (MAX_VIEWS + 3, 3)]
)
def test_trim_keeps_newest_up_to_limit(
    client: TestClient, users: Any, small_limit: None, count: int, removed: int
) -> None:
    viewer, recipes = _viewer_with(client, users, count)

    _run(trim_recipe_views)

    assert _views_of(viewer) == set(recipes[removed:])  # 古い順に消え、新しい上限件が残る


def test_trim_ties_are_deterministic(client: TestClient, users: Any, small_limit: None) -> None:
    viewer, recipes = _viewer_with(client, users, MAX_VIEWS + 2)
    _exec("UPDATE recipe_views SET viewed_at = now() WHERE user_id = :u", u=viewer.uuid)

    _run(trim_recipe_views)

    # 同じ時刻なら recipe_id の大きい方を「新しい」として残す。
    assert _views_of(viewer) == set(sorted(recipes)[-MAX_VIEWS:])


def test_trim_multiple_batches(client: TestClient, users: Any, small_limit: None) -> None:
    viewer, recipes = _viewer_with(client, users, MAX_VIEWS + 3)

    _run(trim_recipe_views, batch_size=2)

    assert _views_of(viewer) == set(recipes[3:])


def test_trim_skips_user_being_trimmed_elsewhere(
    client: TestClient, users: Any, small_limit: None
) -> None:
    """同じユーザーを削っている別のジョブがいたら飛ばす。他のユーザーは処理する。"""
    busy, busy_recipes = _viewer_with(client, users, MAX_VIEWS + 2)
    other, other_recipes = _viewer_with(client, users, MAX_VIEWS + 1)

    with Session(engine) as holder:
        holder.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('trim_recipe_views:' || :u))"),
            {"u": busy.id},
        )
        _run(trim_recipe_views)
        holder.rollback()

    assert _views_of(busy) == set(busy_recipes)  # 手付かず
    assert _views_of(other) == set(other_recipes[1:])  # 他のユーザーは処理された
    _run(trim_recipe_views)
    assert _views_of(busy) == set(busy_recipes[2:])  # ちょうど上限まで（下回らない）


def test_trim_does_not_delete_a_row_viewed_during_the_delete(
    client: TestClient, users: Any, small_limit: None
) -> None:
    """消そうとした行が、削除の最中の閲覧で新しくなってコミットされたら消さない。"""
    viewer, recipes = _viewer_with(client, users, MAX_VIEWS + 1)
    oldest = recipes[0]
    errors: list[BaseException] = []

    def run() -> None:
        try:
            _run(trim_recipe_views)
        except BaseException as exc:  # noqa: BLE001  スレッド内の失敗を親へ渡す
            errors.append(exc)

    with Session(engine) as viewer_tx:
        # 閲覧の記録と同じ更新を、コミットせずに行ってロックを持ったままにする。
        viewer_tx.execute(
            text(
                "UPDATE recipe_views SET viewed_at = clock_timestamp()"
                " WHERE user_id = :u AND recipe_id = :r"
            ),
            {"u": viewer.uuid, "r": uuid.UUID(oldest)},
        )
        thread = threading.Thread(target=run)
        thread.start()
        deadline = datetime.now(UTC) + timedelta(seconds=20)
        while datetime.now(UTC) < deadline:
            waiting = _scalar(
                "SELECT count(*) FROM pg_stat_activity WHERE state = 'active'"
                " AND wait_event_type = 'Lock' AND query ILIKE '%DELETE FROM recipe_views%'"
            )
            if waiting:
                break
            threading.Event().wait(0.02)
        assert waiting, "削除がロック待ちに入らなかった"
        viewer_tx.commit()
    thread.join(timeout=30)
    assert not errors, errors

    assert oldest in _views_of(viewer)  # 新しくなった行は消えない
    assert len(_views_of(viewer)) >= MAX_VIEWS  # 上限を下回らない


# --- recount（4 列） ----------------------------------------------------------


def test_recount_fixes_all_four_columns_idempotently(client: TestClient, users: Any) -> None:
    a, b = users(), users()
    assert client.post(f"/api/v1/users/{b.id}/follow", headers=a.headers).status_code == 204
    rid = client.post("/api/v1/recipes", json=recipe_payload(), headers=b.headers).json()["id"]
    assert client.post(f"/api/v1/recipes/{rid}/favorite", headers=a.headers).status_code == 204
    res = client.post(f"/api/v1/recipes/{rid}/comments", json={"body": "感想"}, headers=a.headers)
    assert res.status_code == 201
    _exec(
        "UPDATE users SET following_count = 9, follower_count = 9 WHERE id IN (:a, :b)",
        a=a.uuid,
        b=b.uuid,
    )
    _exec(
        "UPDATE recipes SET favorite_count = 9, comment_count = 9 WHERE id = :r", r=uuid.UUID(rid)
    )

    def values() -> tuple[Any, ...]:
        with Session(engine) as s:
            ua = s.execute(
                text("SELECT following_count, follower_count FROM users WHERE id = :i"),
                {"i": a.uuid},
            ).one()
            ub = s.execute(
                text("SELECT following_count, follower_count FROM users WHERE id = :i"),
                {"i": b.uuid},
            ).one()
            r = s.execute(
                text("SELECT favorite_count, comment_count FROM recipes WHERE id = :i"),
                {"i": uuid.UUID(rid)},
            ).one()
        return tuple(ua), tuple(ub), tuple(r)

    recount_counts.main()
    assert values() == ((1, 0), (0, 1), (1, 1))
    recount_counts.main()  # 2 回目でも変わらない（冪等）
    assert values() == ((1, 0), (0, 1), (1, 1))


# --- コマンド --------------------------------------------------------------------


@pytest.mark.parametrize(
    "module", ["cleanup_refresh_tokens", "cleanup_notifications", "trim_recipe_views"]
)
def test_job_commands_exit_zero(module: str) -> None:
    res = subprocess.run(
        [sys.executable, "-m", f"app.jobs.{module}"], capture_output=True, timeout=180
    )
    assert res.returncode == 0, res.stderr.decode(errors="replace")
