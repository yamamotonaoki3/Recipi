"""GET /api/v1/recipes（ホーム「全体」フィード ＋ 検索 ＋ ページング）の結合テスト。

Issue #41 / features/home-feed.md・search.md の受け入れ基準（backend・feed=all 範囲）。
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from tests.helpers import auth_headers, recipe_payload

pytestmark = pytest.mark.integration

RECIPES_URL = "/api/v1/recipes"


def _create(client: TestClient, headers: dict[str, str], **overrides) -> str:
    res = client.post(RECIPES_URL, json=recipe_payload(**overrides), headers=headers)
    assert res.status_code == 201, res.text
    return str(res.json()["id"])


def _unique_author(client: TestClient) -> tuple[dict[str, str], str]:
    """このテスト専用の表示名を持つユーザーを作る。

    フィードは全公開レシピを横断するので、他テストが残したレシピと混ざる。
    レスポンスの `author.displayName` でこのテストの投稿分だけに絞り込めるよう、
    衝突しない表示名を返す（表示名は最大 30 文字なので短く作る）。
    """
    name = f"e2e_{uuid.uuid4().hex[:12]}"
    return auth_headers(client, display_name=name), name


def _feed_titles_by_author(
    client: TestClient,
    headers: dict[str, str],
    author_name: str,
    *,
    params: dict[str, object] | None = None,
):
    """フィードを最後までページングし、指定投稿者のレシピタイトルを新着順で返す。

    テスト用 DB は使い捨てだが 1 セッション内で他テストが公開レシピを大量に残すため、
    「1 ページ目に自分のぶんが全部入っている」前提は置けない（Codex #41 P1 指摘）。
    `nextCursor` を最後までたどり、`author.displayName` でこのテストの投稿分だけ拾う。
    """
    return [i["title"] for i in _feed_items_by_author(client, headers, author_name, params=params)]


def _feed_items_by_author(
    client: TestClient,
    headers: dict[str, str],
    author_name: str,
    *,
    params: dict[str, object] | None = None,
):
    """`_feed_titles_by_author` の items 版（カード形状の確認に使う）。"""
    items: list[object] = []
    cursor: str | None = None
    for _ in range(200):  # 使い捨て DB でも全レシピ数はこの範囲に収まる
        # 値が None のキーは送らない（`feed=None` で「feed 省略」を再現できるように）。
        merged = {"feed": "all", "limit": 50, **(params or {})}
        query: dict[str, object] = {k: v for k, v in merged.items() if v is not None}
        if cursor:
            query["cursor"] = cursor
        page = client.get(RECIPES_URL, params=query, headers=headers).json()
        items.extend(i for i in page["items"] if i["author"]["displayName"] == author_name)
        cursor = page["nextCursor"]
        if cursor is None:
            break
    return items


def test_feed_shows_only_public_recipes_newest_first(client: TestClient) -> None:
    alice, alice_name = _unique_author(client)
    bob, bob_name = _unique_author(client)

    _create(client, alice, title="公開1", isPublic=True)
    _create(client, alice, title="非公開", isPublic=False)
    _create(client, bob, title="ボブ公開", isPublic=True)
    _create(client, alice, title="公開2", isPublic=True)

    viewer, _ = _unique_author(client)
    mine = _feed_titles_by_author(client, viewer, alice_name)
    assert "非公開" not in mine
    # 新着順（作成が新しいものが先頭）。
    assert mine == ["公開2", "公開1"]
    bob_items = _feed_items_by_author(client, viewer, bob_name)
    assert [i["title"] for i in bob_items] == ["ボブ公開"]

    # カード形状: id / title / thumbnailUrl / author / favoriteCount / isFavorited のみ
    # （isFavorited は Issue #68 で追加。閲覧者はまだ何もお気に入りしていないので false）。
    sample = bob_items[0]
    assert set(sample) == {
        "id",
        "title",
        "thumbnailUrl",
        "author",
        "favoriteCount",
        "isFavorited",
    }
    assert sample["favoriteCount"] == 0
    assert sample["isFavorited"] is False
    assert sample["thumbnailUrl"] is None
    assert sample["author"]["displayName"] == bob_name


def test_feed_hides_own_private_recipes(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="自分の非公開", isPublic=False)
    _create(client, headers, title="自分の公開", isPublic=True)
    assert _feed_titles_by_author(client, headers, name) == ["自分の公開"]


def test_feed_defaults_to_all(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="デフォルトfeed", isPublic=True)
    # feed 省略でも all として動く（`params` の feed を空にして省略を再現）。
    got = _feed_titles_by_author(client, headers, name, params={"feed": None})
    assert got == ["デフォルトfeed"]


def test_feed_requires_auth(client: TestClient) -> None:
    assert client.get(RECIPES_URL).status_code == 401


# `favorites` は Issue #68 で解禁したので、ここには定義に無い値だけを並べる。
@pytest.mark.parametrize("feed", ["bogus", "ALL", ""])
def test_feed_unsupported_values_are_rejected(client: TestClient, feed: str) -> None:
    """定義に無い値は 400（home-feed.md §6）。

    `following` / `followers` は Issue #66、`favorites` は Issue #68 で有効化したので、
    ここには含めない。
    """
    headers = auth_headers(client)
    res = client.get(RECIPES_URL, params={"feed": feed}, headers=headers)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("limit", "expected"),
    [("0", 400), ("1", 200), ("50", 200), ("51", 400)],
)
def test_feed_limit_boundaries(client: TestClient, limit: str, expected: int) -> None:
    headers = auth_headers(client)
    _create(client, headers, title="境界値用", isPublic=True)
    res = client.get(RECIPES_URL, params={"feed": "all", "limit": limit}, headers=headers)
    assert res.status_code == expected


def _walk_feed(client: TestClient, headers: dict[str, str], want: set[str]) -> set[str]:
    """limit=2 でフィードをページングし、id の重複が無いことを確認しつつ全 id を集める。

    `want`（このテストが作った id）を全部見たら早期終了する。フィードは全公開
    レシピ横断で他テストのぶんも延々続くため、上限ページ数の保険も付ける。
    """
    seen: set[str] = set()
    cursor: str | None = None
    for _ in range(60):
        params: dict[str, object] = {"feed": "all", "limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = client.get(RECIPES_URL, params=params, headers=headers).json()
        page_ids = [i["id"] for i in page["items"]]
        assert not (set(page_ids) & seen), "同じ id が複数ページに出た（重複）"
        seen.update(page_ids)
        cursor = page["nextCursor"]
        if cursor is None or want <= seen:
            break
    return seen


def test_feed_pagination_walks_all_rows(client: TestClient) -> None:
    headers, _ = _unique_author(client)
    created = {_create(client, headers, title=f"ページング{i}", isPublic=True) for i in range(5)}
    assert created <= _walk_feed(client, headers, created)


def test_feed_pagination_handles_equal_created_at(client: TestClient, db_session: Session) -> None:
    """created_at が全く同じレコードでも、id タイブレークで重複・抜けなくたどれる。"""
    from app.models.recipe import Recipe

    headers, _ = _unique_author(client)
    marker = uuid.uuid4().hex[:8]
    ids = {_create(client, headers, title=f"同時刻{marker}_{i}", isPublic=True) for i in range(6)}

    # 作成した 6 件の created_at を「そのうち最も新しい値」にそろえる。
    # これで 6 件は created_at が完全一致し（＝id タイブレークの検証対象になり）、
    # かつフィード上の位置は今と変わらない（未来日時にしないので DB を汚さない）。
    recipes = db_session.exec(
        select(Recipe).where(Recipe.title.like(f"同時刻{marker}%"))  # type: ignore[attr-defined]
    ).all()
    same_time = max(r.created_at for r in recipes)
    for r in recipes:
        r.created_at = same_time
        db_session.add(r)
    db_session.commit()

    # 6 件は今作ったばかり＝フィード上位。limit=2 で全ページたどり、
    # 同 created_at のまたぎ目でも重複・抜けが無いことを確認する。
    assert ids <= _walk_feed(client, headers, ids)


# --- 検索（features/search.md） ------------------------------------------


def _search_titles(client: TestClient, headers: dict[str, str], author_name: str, q: str):
    """検索結果を全ページたどり、指定投稿者のタイトルだけ返す。"""
    return _feed_titles_by_author(client, headers, author_name, params={"q": q})


def test_q_single_term_matches_title_or_ingredient(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="玉ねぎスープ", isPublic=True)
    _create(
        client,
        headers,
        title="謎の炒め物",
        isPublic=True,
        ingredientGroups=[
            {"name": None, "ingredients": [{"name": "玉ねぎ", "quantity": 1, "unit": "個"}]}
        ],
    )
    _create(client, headers, title="味噌汁だけ", isPublic=True)

    # タイトル一致（玉ねぎスープ）と材料名一致（謎の炒め物）の両方が返る。
    found = set(_search_titles(client, headers, name, "玉ねぎ"))
    assert found == {"玉ねぎスープ", "謎の炒め物"}


def test_q_multiple_terms_are_anded_incl_fullwidth_space(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="玉ねぎと豚肉の炒め物X", isPublic=True)
    _create(client, headers, title="玉ねぎサラダX", isPublic=True)

    for q in ("玉ねぎ 豚肉", "玉ねぎ　豚肉"):  # 半角 / 全角スペース
        assert _search_titles(client, headers, name, q) == ["玉ねぎと豚肉の炒め物X"]


def test_q_without_space_is_single_term(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="玉ねぎと豚肉の炒め物Y", isPublic=True)
    assert _search_titles(client, headers, name, "玉ねぎ豚肉") == []


def test_q_case_and_width_insensitive(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="ABC Pancake Z", isPublic=True)
    assert _search_titles(client, headers, name, "ｐａｎｃａｋｅ　ｚ") == ["ABC Pancake Z"]


def test_q_wildcard_chars_are_literal(client: TestClient) -> None:
    headers, name = _unique_author(client)
    _create(client, headers, title="100%オレンジW", isPublic=True)
    _create(client, headers, title="ただのジュースW", isPublic=True)
    # "%" は SQL ワイルドカードではなくリテラル。"%" を含むレシピだけがヒットする。
    assert _search_titles(client, headers, name, "%") == ["100%オレンジW"]


def test_q_too_many_terms_returns_400(client: TestClient) -> None:
    headers, _ = _unique_author(client)
    res = client.get(RECIPES_URL, params={"feed": "all", "q": "a b c d e f"}, headers=headers)
    assert res.status_code == 400


@pytest.mark.parametrize("cursor", ["not-base64!!", "日本語カーソル"])
def test_feed_malformed_cursor_returns_400(client: TestClient, cursor: str) -> None:
    headers = auth_headers(client)
    res = client.get(RECIPES_URL, params={"feed": "all", "cursor": cursor}, headers=headers)
    assert res.status_code == 400


# --- feed=following / followers（Issue #66・features/home-feed.md） -----


def _follow(client: TestClient, headers: dict[str, str], target_id: str) -> None:
    res = client.post(f"/api/v1/users/{target_id}/follow", headers=headers)
    assert res.status_code == 204, res.text


def _user_id(client: TestClient, headers: dict[str, str]) -> str:
    """認証ヘッダーの持ち主の id を返す（自分のプロフィールから取る）。"""
    me = client.get("/api/v1/users/me/following", headers=headers)
    assert me.status_code == 200
    # `/users/me/*` は id を返さないので、レシピを 1 件作ってその author から取る。
    res = client.post(
        RECIPES_URL, json=recipe_payload(title="__id_probe__", isPublic=False), headers=headers
    )
    assert res.status_code == 201, res.text
    author_id: str = res.json()["author"]["id"]
    client.delete(f"{RECIPES_URL}/{res.json()['id']}", headers=headers)
    return author_id


def test_feed_following_shows_only_followed_authors(client: TestClient) -> None:
    """「フォロー」タブにはフォロー中ユーザーの公開レシピだけが出る（home-feed.md §7）。"""
    viewer_headers, viewer_name = _unique_author(client)
    followed_headers, followed_name = _unique_author(client)
    other_headers, other_name = _unique_author(client)

    followed_id = _user_id(client, followed_headers)
    _follow(client, viewer_headers, followed_id)

    _create(client, followed_headers, title="フォロー中の公開レシピ", isPublic=True)
    _create(client, followed_headers, title="フォロー中の非公開レシピ", isPublic=False)
    _create(client, other_headers, title="無関係な人の公開レシピ", isPublic=True)

    titles = _feed_titles_by_author(
        client, viewer_headers, followed_name, params={"feed": "following"}
    )
    assert titles == ["フォロー中の公開レシピ"]

    # 無関係な投稿者のレシピは 1 件も出ない。
    assert (
        _feed_titles_by_author(client, viewer_headers, other_name, params={"feed": "following"})
        == []
    )
    # 自分自身のレシピも（自分をフォローできない以上）出ない。
    assert (
        _feed_titles_by_author(client, viewer_headers, viewer_name, params={"feed": "following"})
        == []
    )


def test_feed_followers_shows_only_authors_who_follow_me(client: TestClient) -> None:
    """「フォロワー」タブには自分をフォローしている人の公開レシピだけが出る。"""
    viewer_headers, _ = _unique_author(client)
    follower_headers, follower_name = _unique_author(client)
    other_headers, other_name = _unique_author(client)

    viewer_id = _user_id(client, viewer_headers)
    _follow(client, follower_headers, viewer_id)

    _create(client, follower_headers, title="フォロワーの公開レシピ", isPublic=True)
    _create(client, follower_headers, title="フォロワーの非公開レシピ", isPublic=False)
    _create(client, other_headers, title="無関係な人の公開レシピ2", isPublic=True)

    titles = _feed_titles_by_author(
        client, viewer_headers, follower_name, params={"feed": "followers"}
    )
    assert titles == ["フォロワーの公開レシピ"]
    assert (
        _feed_titles_by_author(client, viewer_headers, other_name, params={"feed": "followers"})
        == []
    )


def test_feed_following_is_empty_without_follows(client: TestClient) -> None:
    """フォロー 0 なら空（画面はここで空状態メッセージを出す）。"""
    viewer_headers, _ = _unique_author(client)
    res = client.get(RECIPES_URL, params={"feed": "following", "limit": 50}, headers=viewer_headers)
    assert res.status_code == 200, res.text
    assert res.json()["items"] == []


def test_feed_following_can_be_narrowed_by_q(client: TestClient) -> None:
    """検索語は表示中のタブの集合の中だけで絞り込む（home-feed.md §3）。"""
    viewer_headers, _ = _unique_author(client)
    followed_headers, followed_name = _unique_author(client)

    _follow(client, viewer_headers, _user_id(client, followed_headers))
    _create(client, followed_headers, title="肉じゃが", isPublic=True)
    _create(client, followed_headers, title="カレーライス", isPublic=True)

    titles = _feed_titles_by_author(
        client, viewer_headers, followed_name, params={"feed": "following", "q": "カレー"}
    )
    assert titles == ["カレーライス"]


def test_feed_following_reflects_unfollow(client: TestClient) -> None:
    """フォロー解除の結果は次の取得に反映される（home-feed.md §7）。"""
    viewer_headers, _ = _unique_author(client)
    followed_headers, followed_name = _unique_author(client)
    followed_id = _user_id(client, followed_headers)

    _follow(client, viewer_headers, followed_id)
    _create(client, followed_headers, title="解除前に見えるレシピ", isPublic=True)
    assert _feed_titles_by_author(
        client, viewer_headers, followed_name, params={"feed": "following"}
    ) == ["解除前に見えるレシピ"]

    client.delete(f"/api/v1/users/{followed_id}/follow", headers=viewer_headers)
    assert (
        _feed_titles_by_author(client, viewer_headers, followed_name, params={"feed": "following"})
        == []
    )
