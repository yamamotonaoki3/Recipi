"""フォロー / フォロワー API の結合テスト（Issue #66 / features/follow.md）。

BB（仕様ベース）: §7 の受け入れ基準、`limit` の境界値、壊れたカーソル。
WB（実装ベース）: 「実際に 1 行増減した」分岐と「ON CONFLICT DO NOTHING で
何もしなかった」分岐、通知を作る / 作らない分岐。
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models.follow import Follow
from app.models.notification import Notification
from tests.helpers import auth_headers, signup

pytestmark = pytest.mark.integration

USERS_URL = "/api/v1/users"


def _make_user(client: TestClient) -> tuple[dict[str, str], str]:
    """テスト用ユーザーを 1 人作り、(認証ヘッダー, user_id) を返す。"""
    name = f"testuser_{uuid.uuid4().hex[:12]}"
    body = signup(client, display_name=name)
    headers = {"Authorization": f"Bearer {body['accessToken']}"}
    return headers, str(body["user"]["id"])


def _profile(client: TestClient, headers: dict[str, str], user_id: str) -> dict:
    res = client.get(f"{USERS_URL}/{user_id}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _counts(client: TestClient, headers: dict[str, str], user_id: str) -> tuple[int, int]:
    """(followingCount, followerCount) を返す。"""
    body = _profile(client, headers, user_id)
    return body["followingCount"], body["followerCount"]


def _rows(client: TestClient, headers: dict[str, str], url: str, **params) -> list[dict]:
    """一覧を最後までページングして全件返す。"""
    items: list[dict] = []
    cursor: str | None = None
    for _ in range(50):
        query: dict[str, object] = {"limit": 50, **params}
        if cursor:
            query["cursor"] = cursor
        res = client.get(url, params=query, headers=headers)
        assert res.status_code == 200, res.text
        page = res.json()
        items.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            break
    return items


# --- 基本のフォロー / 解除 -------------------------------------------


def test_follow_increments_both_counts(client: TestClient) -> None:
    """フォローすると相手のフォロワー数と自分のフォロー数が +1（follow.md §7）。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)

    assert _counts(client, a_headers, a_id) == (0, 0)
    assert _counts(client, a_headers, b_id) == (0, 0)

    res = client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    assert res.status_code == 204, res.text

    assert _counts(client, a_headers, a_id) == (1, 0)
    assert _counts(client, a_headers, b_id) == (0, 1)


def test_unfollow_decrements_both_counts(client: TestClient) -> None:
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    res = client.delete(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    assert res.status_code == 204, res.text

    assert _counts(client, a_headers, a_id) == (0, 0)
    assert _counts(client, a_headers, b_id) == (0, 0)


def test_double_follow_is_idempotent(client: TestClient, db_session: Session) -> None:
    """二重フォローしても行は 1 件・カウントも 1 のまま（WB: rowcount 0 の分岐）。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)

    for _ in range(3):
        assert client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers).status_code == 204

    assert _counts(client, a_headers, a_id) == (1, 0)
    assert _counts(client, a_headers, b_id) == (0, 1)

    rows = db_session.exec(
        select(Follow).where(
            Follow.follower_id == uuid.UUID(a_id),
            Follow.followee_id == uuid.UUID(b_id),
        )
    ).all()
    assert len(rows) == 1


def test_unfollow_when_not_following_is_idempotent(client: TestClient) -> None:
    """未フォローの解除も 204 で、カウントは動かない（WB: rowcount 0 の分岐）。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)

    res = client.delete(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    assert res.status_code == 204, res.text
    assert _counts(client, a_headers, a_id) == (0, 0)
    assert _counts(client, a_headers, b_id) == (0, 0)


def test_follow_self_returns_400(client: TestClient) -> None:
    a_headers, a_id = _make_user(client)
    res = client.post(f"{USERS_URL}/{a_id}/follow", headers=a_headers)
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_follow_unknown_user_returns_404(client: TestClient) -> None:
    a_headers, _ = _make_user(client)
    res = client.post(f"{USERS_URL}/{uuid.uuid4()}/follow", headers=a_headers)
    assert res.status_code == 404, res.text


def test_mutual_follow(client: TestClient) -> None:
    """相互フォローが成立し、両者の一覧に相手が出る（follow.md §7）。"""
    a_headers, a_id = _make_user(client)
    b_headers, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    client.post(f"{USERS_URL}/{a_id}/follow", headers=b_headers)

    assert _counts(client, a_headers, a_id) == (1, 1)
    assert _counts(client, a_headers, b_id) == (1, 1)

    a_following = _rows(client, a_headers, f"{USERS_URL}/me/following")
    b_following = _rows(client, b_headers, f"{USERS_URL}/me/following")
    assert [r["id"] for r in a_following] == [b_id]
    assert [r["id"] for r in b_following] == [a_id]


# --- 一覧 -------------------------------------------------------------


def test_following_and_followers_lists(client: TestClient) -> None:
    a_headers, a_id = _make_user(client)
    b_headers, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    a_following = _rows(client, a_headers, f"{USERS_URL}/me/following")
    assert [r["id"] for r in a_following] == [b_id]

    b_followers = _rows(client, b_headers, f"{USERS_URL}/me/followers")
    assert [r["id"] for r in b_followers] == [a_id]

    # 一覧の行は「アバター + 表示名 + フォロー状態」を出すのに必要な形をしている。
    row = a_following[0]
    assert set(row) == {"id", "displayName", "avatarUrl", "isFollowing"}
    assert row["avatarUrl"] is None  # アバターはプロフィール拡張の Issue で入る


def test_is_following_is_from_the_viewers_perspective(client: TestClient) -> None:
    """`isFollowing` は一覧の持ち主ではなく**閲覧者**から見た状態（follow.md §5）。

    B が自分のフォロワー一覧（＝ A が並ぶ）を見たとき:
    - フォローバック前は A の isFollowing = false
    - B が A をフォローし返すと true になる
    """
    a_headers, a_id = _make_user(client)
    b_headers, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    before = _rows(client, b_headers, f"{USERS_URL}/me/followers")
    assert [(r["id"], r["isFollowing"]) for r in before] == [(a_id, False)]

    client.post(f"{USERS_URL}/{a_id}/follow", headers=b_headers)

    after = _rows(client, b_headers, f"{USERS_URL}/me/followers")
    assert [(r["id"], r["isFollowing"]) for r in after] == [(a_id, True)]


def test_other_users_following_and_followers_are_visible(client: TestClient) -> None:
    """他ユーザーのプロフィールからその人の一覧を閲覧できる（follow.md §7）。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)
    c_headers, c_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    # C（無関係な第三者）から見ても、A のフォロー中一覧に B が並ぶ。
    a_following = _rows(client, c_headers, f"{USERS_URL}/{a_id}/following")
    assert [r["id"] for r in a_following] == [b_id]
    # C は B をフォローしていないので false。
    assert a_following[0]["isFollowing"] is False

    b_followers = _rows(client, c_headers, f"{USERS_URL}/{b_id}/followers")
    assert [r["id"] for r in b_followers] == [a_id]
    assert c_id not in [r["id"] for r in b_followers]


def test_me_shortcut_matches_explicit_id(client: TestClient) -> None:
    """`/users/me/following` は `/users/{自分の id}/following` と同義（follow.md §5）。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)
    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    via_me = _rows(client, a_headers, f"{USERS_URL}/me/following")
    via_id = _rows(client, a_headers, f"{USERS_URL}/{a_id}/following")
    assert via_me == via_id


def test_list_of_unknown_user_returns_404(client: TestClient) -> None:
    a_headers, _ = _make_user(client)
    missing = uuid.uuid4()
    assert client.get(f"{USERS_URL}/{missing}/following", headers=a_headers).status_code == 404
    assert client.get(f"{USERS_URL}/{missing}/followers", headers=a_headers).status_code == 404


def test_empty_lists(client: TestClient) -> None:
    """フォロー 0 / フォロワー 0 のときは空配列 ＋ nextCursor は null。"""
    a_headers, _ = _make_user(client)
    for url in (f"{USERS_URL}/me/following", f"{USERS_URL}/me/followers"):
        body = client.get(url, headers=a_headers).json()
        assert body["items"] == []
        assert body["nextCursor"] is None


def test_pagination_walks_all_rows(client: TestClient) -> None:
    """カーソルページングで全件たどれ、重複も抜けもない。"""
    a_headers, _ = _make_user(client)
    targets = []
    for _ in range(5):
        _, target_id = _make_user(client)
        assert client.post(f"{USERS_URL}/{target_id}/follow", headers=a_headers).status_code == 204
        targets.append(target_id)

    # limit=2 で 3 ページに分けてたどる。
    collected = _rows(client, a_headers, f"{USERS_URL}/me/following", limit=2)
    ids = [r["id"] for r in collected]
    assert len(ids) == len(set(ids)) == 5
    assert set(ids) == set(targets)
    # 並びは「新しくフォローした順」なので、最後にフォローした人が先頭。
    assert ids[0] == targets[-1]


@pytest.mark.parametrize(
    ("limit", "expected"),
    [(0, 400), (1, 200), (50, 200), (51, 400)],
)
def test_limit_boundaries(client: TestClient, limit: int, expected: int) -> None:
    a_headers, _ = _make_user(client)
    res = client.get(f"{USERS_URL}/me/following", params={"limit": limit}, headers=a_headers)
    assert res.status_code == expected, res.text


@pytest.mark.parametrize("cursor", ["not-base64!!", "日本語カーソル", "YWJj"])
def test_malformed_cursor_returns_400(client: TestClient, cursor: str) -> None:
    """壊れたカーソルは 500 ではなく 400（recipe.py / history.py と同じ方針）。"""
    a_headers, _ = _make_user(client)
    res = client.get(f"{USERS_URL}/me/following", params={"cursor": cursor}, headers=a_headers)
    assert res.status_code == 400, res.text


def test_endpoints_require_auth(client: TestClient) -> None:
    _, b_id = _make_user(client)
    assert client.post(f"{USERS_URL}/{b_id}/follow").status_code == 401
    assert client.delete(f"{USERS_URL}/{b_id}/follow").status_code == 401
    assert client.get(f"{USERS_URL}/me/following").status_code == 401
    assert client.get(f"{USERS_URL}/me/followers").status_code == 401
    assert client.get(f"{USERS_URL}/{b_id}/following").status_code == 401
    assert client.get(f"{USERS_URL}/{b_id}/followers").status_code == 401
    assert client.get(f"{USERS_URL}/{b_id}").status_code == 401


# --- プロフィール（最小版） -------------------------------------------


def test_profile_is_following_is_null_for_self(client: TestClient) -> None:
    """自分自身の取得では `isFollowing` は null（profile.md §5）。"""
    a_headers, a_id = _make_user(client)
    assert _profile(client, a_headers, a_id)["isFollowing"] is None


def test_profile_is_following_reflects_state(client: TestClient) -> None:
    a_headers, _ = _make_user(client)
    _, b_id = _make_user(client)

    assert _profile(client, a_headers, b_id)["isFollowing"] is False
    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    assert _profile(client, a_headers, b_id)["isFollowing"] is True


def test_profile_of_unknown_user_returns_404(client: TestClient) -> None:
    a_headers, _ = _make_user(client)
    assert client.get(f"{USERS_URL}/{uuid.uuid4()}", headers=a_headers).status_code == 404


# --- 通知 -------------------------------------------------------------


def _followed_notifications(session: Session, user_id: str) -> list[Notification]:
    return list(
        session.exec(
            select(Notification).where(
                Notification.user_id == uuid.UUID(user_id),
                Notification.type == "followed",
            )
        ).all()
    )


def test_follow_creates_a_followed_notification(client: TestClient, db_session: Session) -> None:
    """フォロー成立時に被フォロー者へ `followed` 通知が 1 件（notification.md §7）。"""
    a_headers, a_id = _make_user(client)
    _, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    rows = _followed_notifications(db_session, b_id)
    assert len(rows) == 1
    assert str(rows[0].actor_id) == a_id
    assert rows[0].recipe_id is None
    assert rows[0].read_at is None  # 未読で作られる


def test_refollow_does_not_create_another_notification(
    client: TestClient, db_session: Session
) -> None:
    """冪等な再フォローでは通知を作らない（notification.md §3 / WB: rowcount 0 の分岐）。"""
    a_headers, _ = _make_user(client)
    _, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    assert len(_followed_notifications(db_session, b_id)) == 1


def test_unfollow_keeps_existing_notification(client: TestClient, db_session: Session) -> None:
    """通知は出来事の履歴なので、フォロー解除しても消さない（notification.md §3）。"""
    a_headers, _ = _make_user(client)
    _, b_id = _make_user(client)

    client.post(f"{USERS_URL}/{b_id}/follow", headers=a_headers)
    client.delete(f"{USERS_URL}/{b_id}/follow", headers=a_headers)

    assert len(_followed_notifications(db_session, b_id)) == 1


# --- 同時実行 ---------------------------------------------------------


def test_concurrent_follows_keep_the_count_correct(client: TestClient) -> None:
    """同じユーザーへ同時にフォローが来てもカウントが正しい（follow.md §7）。

    5 人が同じ相手を「ほぼ同時に」フォローする。行ロックで直列化されるので、
    クライアントにエラーは返らず、フォロワー数はちょうど 5 になる。
    """
    import threading

    _, target_id = _make_user(client)
    followers = [_make_user(client)[0] for _ in range(5)]
    statuses: list[int] = []
    lock = threading.Lock()

    def do_follow(headers: dict[str, str]) -> None:
        # TestClient は都度リクエストを組み立てるのでスレッドから使える。
        res = client.post(f"{USERS_URL}/{target_id}/follow", headers=headers)
        with lock:
            statuses.append(res.status_code)

    threads = [threading.Thread(target=do_follow, args=(h,)) for h in followers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert statuses == [204] * 5, statuses
    viewer = auth_headers(client, display_name=f"testuser_{uuid.uuid4().hex[:10]}")
    assert _counts(client, viewer, target_id)[1] == 5


def test_concurrent_mutual_follows_do_not_deadlock(client: TestClient) -> None:
    """A→B と B→A が同時に来てもデッドロックしない（WB: id 昇順ロック）。

    2 人が互いを同時にフォローすると、触る `users` 行は同じ 2 行で順序だけが
    逆になる。ロックを id 昇順で取っていないと、ここで待ち合いが起きる。
    """
    import threading

    a_headers, a_id = _make_user(client)
    b_headers, b_id = _make_user(client)
    statuses: list[int] = []
    lock = threading.Lock()
    start = threading.Barrier(2)

    def do_follow(headers: dict[str, str], target: str) -> None:
        start.wait()  # 2 スレッドの開始をそろえて、衝突しやすくする
        res = client.post(f"{USERS_URL}/{target}/follow", headers=headers)
        with lock:
            statuses.append(res.status_code)

    threads = [
        threading.Thread(target=do_follow, args=(a_headers, b_id)),
        threading.Thread(target=do_follow, args=(b_headers, a_id)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert statuses == [204, 204], statuses
    assert _counts(client, a_headers, a_id) == (1, 1)
    assert _counts(client, a_headers, b_id) == (1, 1)
