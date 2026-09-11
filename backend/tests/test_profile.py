"""プロフィール（表示名・連絡先 / SNS の公開設定）の結合テスト（Issue #67）。

features/profile.md §5〜§7、non-functional.md「データの可視性ルール」。

BB（仕様ベース）: 表示名の境界値（0 / 1 / 30 / 31 文字・空白だけ）、URL の同値分割、
表示名の変更が一覧・プロフィールに反映されること。
WB（実装ベース）: `PATCH` の「未指定 / null / 値」の分岐、可視性の分岐
（本人 / 他人 × 公開 ON / OFF）、他人向けで公開 OFF の項目がキーごと無いこと。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.helpers import recipe_payload, signup

pytestmark = pytest.mark.integration

USERS_URL = "/api/v1/users"
ME_URL = f"{USERS_URL}/me"
RECIPES_URL = "/api/v1/recipes"

# 互いに違う URL にしておく（公開された値の取り違えを見分けるため）。
# テストデータの規約どおり example.com 配下のダミー。
URLS = {
    "x": "https://x.example.com/testuser_profile",
    "instagram": "https://instagram.example.com/testuser_profile",
    "other": "https://blog.example.com/testuser_profile",
}

# 他人向けプロフィールで**常に**出るキー（公開トグルの対象外）。
PUBLIC_BASE_KEYS = {
    "id",
    "displayName",
    "avatarUrl",
    "followingCount",
    "followerCount",
    "isFollowing",
    "links",
}

# 本人向けにだけ出るキー。他人向けに 1 つでも混ざったら情報漏えい。
SELF_ONLY_KEYS = {
    "emailPublic",
    "xUrl",
    "xPublic",
    "instagramUrl",
    "instagramPublic",
    "otherUrl",
    "otherPublic",
}


class _User:
    """テスト中に使うユーザー 1 人ぶん（認証ヘッダー・id・メール）。"""

    def __init__(self, client: TestClient) -> None:
        body = signup(client, display_name=f"testuser_{uuid.uuid4().hex[:12]}")
        self.headers = {"Authorization": f"Bearer {body['accessToken']}"}
        self.id = str(body["user"]["id"])
        self.email = str(body["email"])


def _patch(client: TestClient, user: _User, body: dict[str, Any]) -> Any:
    return client.patch(ME_URL, json=body, headers=user.headers)


def _profile(client: TestClient, viewer: _User, target: _User) -> dict[str, Any]:
    res = client.get(f"{USERS_URL}/{target.id}", headers=viewer.headers)
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


def _self(client: TestClient, user: _User) -> dict[str, Any]:
    return _profile(client, user, user)


# --- PATCH: 送られた項目だけ更新 -----------------------------------------


def test_empty_patch_changes_nothing(client: TestClient) -> None:
    """空の `{}` でも 200 で、何も変わらない（全項目が任意であることの確認）。"""
    me = _User(client)
    before = _self(client, me)

    res = _patch(client, me, {})

    assert res.status_code == 200, res.text
    assert _self(client, me) == before


def test_patch_updates_only_sent_fields(client: TestClient) -> None:
    """1 項目だけ送ると、他の項目は元のまま。"""
    me = _User(client)
    assert _patch(client, me, {"xUrl": URLS["x"], "xPublic": True}).status_code == 200

    res = _patch(client, me, {"instagramUrl": URLS["instagram"]})

    assert res.status_code == 200, res.text
    body = _self(client, me)
    assert body["xUrl"] == URLS["x"]
    assert body["xPublic"] is True
    assert body["instagramUrl"] == URLS["instagram"]
    assert body["instagramPublic"] is False  # 送っていないので既定の非公開のまま


def test_patch_response_has_settings_in_camel_case(client: TestClient) -> None:
    """応答は本人向けの設定一式（`UserMeResponse`）。既存の 3 項目も残っている。"""
    me = _User(client)

    res = _patch(client, me, {"otherUrl": URLS["other"]})

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == me.id
    assert body["email"] == me.email
    assert "displayName" in body
    assert body["otherUrl"] == URLS["other"]
    assert body["avatarUrl"] is None
    assert "display_name" not in body


# --- 表示名 -------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("", 400),  # 0 文字
        ("あ", 200),  # 1 文字（下限）
        ("あ" * 30, 200),  # 30 文字（上限）
        ("あ" * 31, 400),  # 31 文字
        (" ", 400),  # 半角空白だけ
        ("　", 400),  # 全角空白だけ
    ],
)
def test_display_name_boundaries(client: TestClient, name: str, expected: int) -> None:
    me = _User(client)
    original = _self(client, me)["displayName"]

    res = _patch(client, me, {"displayName": name})

    assert res.status_code == expected, res.text
    if expected == 200:
        assert _self(client, me)["displayName"] == name
    else:
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"
        assert _self(client, me)["displayName"] == original


# --- URL ------------------------------------------------------------------

_URL_PREFIX = "https://example.com/"


@pytest.mark.parametrize(
    ("value", "expected_status", "expected_stored"),
    [
        ("http://example.com/testuser", 200, "http://example.com/testuser"),
        ("https://example.com/testuser", 200, "https://example.com/testuser"),
        ("example.com/testuser", 400, None),  # スキームなし
        ("ftp://example.com/testuser", 400, None),  # http(s) 以外
        ("https://example.com/test user", 400, None),  # 空白を含む
        ("", 200, None),  # 空文字は null 扱い
        ("   ", 200, None),  # 空白だけも null 扱い
        (_URL_PREFIX + "a" * (2048 - len(_URL_PREFIX)), 200, "len2048"),  # 上限ちょうど
        (_URL_PREFIX + "a" * (2049 - len(_URL_PREFIX)), 400, None),  # 上限 + 1
    ],
)
def test_url_validation(
    client: TestClient, value: str, expected_status: int, expected_stored: str | None
) -> None:
    me = _User(client)

    res = _patch(client, me, {"xUrl": value})

    assert res.status_code == expected_status, res.text
    stored = _self(client, me)["xUrl"]
    if expected_stored == "len2048":
        assert stored == value
        assert len(stored) == 2048
    else:
        assert stored == expected_stored


def test_null_url_clears_the_value(client: TestClient) -> None:
    me = _User(client)
    _patch(client, me, {"otherUrl": URLS["other"]})

    res = _patch(client, me, {"otherUrl": None})

    assert res.status_code == 200, res.text
    assert _self(client, me)["otherUrl"] is None


@pytest.mark.parametrize("field", ["displayName", "emailPublic", "xPublic"])
def test_null_for_not_null_columns_is_400(client: TestClient, field: str) -> None:
    """表示名・トグルは DB で NOT NULL。null は 500 ではなく 400 にする。"""
    me = _User(client)

    res = _patch(client, me, {field: None})

    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_invalid_field_rejects_the_whole_patch(client: TestClient) -> None:
    """正しい値と不正な値を同時に送ると 400 で、**正しい値の側も書き換わらない**。"""
    me = _User(client)
    before = _self(client, me)

    res = _patch(client, me, {"xUrl": URLS["x"], "displayName": None})

    assert res.status_code == 400, res.text
    assert _self(client, me) == before


# --- 可視性（本人 / 他人 × 公開 ON / OFF） --------------------------------


def _fill_all(
    client: TestClient, user: _User, *, email: bool, x: bool, ig: bool, other: bool
) -> None:
    res = _patch(
        client,
        user,
        {
            "xUrl": URLS["x"],
            "instagramUrl": URLS["instagram"],
            "otherUrl": URLS["other"],
            "emailPublic": email,
            "xPublic": x,
            "instagramPublic": ig,
            "otherPublic": other,
        },
    )
    assert res.status_code == 200, res.text


@pytest.mark.parametrize(
    ("email", "x", "ig", "other"),
    [
        (False, False, False, False),  # 既定（全部非公開）
        (True, True, True, True),  # 全部公開
        (True, False, False, False),  # メールだけ
        (False, True, False, False),  # X だけ
        (False, False, True, True),  # Instagram とその他
    ],
)
def test_public_profile_contains_only_public_items(
    client: TestClient, email: bool, x: bool, ig: bool, other: bool
) -> None:
    """他人向けは公開 ON の項目だけ。OFF の項目は **null ではなくキーごと無い**。"""
    owner = _User(client)
    viewer = _User(client)
    _fill_all(client, owner, email=email, x=x, ig=ig, other=other)

    body = _profile(client, viewer, owner)

    expected_keys = PUBLIC_BASE_KEYS | ({"email"} if email else set())
    assert set(body) == expected_keys
    assert not (set(body) & SELF_ONLY_KEYS)  # 本人専用の項目は 1 つも無い

    if email:
        assert body["email"] == owner.email  # 公開したのは本人のメール
    else:
        assert "email" not in body

    expected_links = {
        name: URLS[name] for name, on in (("x", x), ("instagram", ig), ("other", other)) if on
    }
    # 値まで比べる（キーだけだと X と Instagram の取り違えを見逃す）。
    assert body["links"] == expected_links
    assert body["isFollowing"] is False


def test_public_toggle_on_without_value_has_no_key(client: TestClient) -> None:
    """公開 ON でも値が無ければキーは出ない（`null` を返さない）。"""
    owner = _User(client)
    viewer = _User(client)
    _patch(client, owner, {"xPublic": True, "xUrl": None})

    body = _profile(client, viewer, owner)

    assert body["links"] == {}


def test_self_profile_contains_everything(client: TestClient) -> None:
    """本人向けは全項目 ＋ 各トグルの状態。`isFollowing` は null。"""
    me = _User(client)
    _fill_all(client, me, email=False, x=True, ig=False, other=True)

    body = _self(client, me)

    assert body["email"] == me.email
    assert body["emailPublic"] is False
    assert body["xUrl"] == URLS["x"]
    assert body["xPublic"] is True
    assert body["instagramUrl"] == URLS["instagram"]  # 非公開でも本人には見える
    assert body["instagramPublic"] is False
    assert body["otherUrl"] == URLS["other"]
    assert body["otherPublic"] is True
    assert body["isFollowing"] is None
    assert body["followingCount"] == 0
    assert body["followerCount"] == 0
    assert "links" not in body


def test_public_profile_openapi_marks_hidden_items_optional(client: TestClient) -> None:
    """OpenAPI 上も、キーごと落とす項目は「必須」ではない（契約の矛盾を作らない）。"""
    schemas = client.get("/api/v1/openapi.json").json()["components"]["schemas"]

    public = schemas["UserPublicProfileResponse"]
    assert "email" in public["properties"]
    assert "email" not in public["required"]
    assert "links" in public["required"]
    assert "displayName" in public["properties"]  # 項目の定義が消えていない

    links = schemas["ProfileLinks"]
    assert set(links["properties"]) == {"x", "instagram", "other"}
    assert links.get("required", []) == []

    assert schemas["UpdateMeRequest"].get("required", []) == []


# --- 表示名の変更が一覧・プロフィールに反映される -------------------------


def _find_in_feed(client: TestClient, viewer: _User, recipe_id: str) -> dict[str, Any]:
    """全体フィードをたどって、指定のレシピを探す（共有 DB なので全件は比べない）。"""
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


def test_display_name_change_is_reflected_everywhere(client: TestClient) -> None:
    """表示名の変更が、プロフィール（本人 / 他人）・詳細・フィード・自分のレシピ一覧・
    フォロー一覧の投稿者に反映される（受け入れ基準「自分の投稿・一覧・プロフィール」）。

    PATCH の直後に別リクエストで確かめるので、応答を返す前に commit していることの
    確認も兼ねる。
    """
    owner = _User(client)
    viewer = _User(client)
    res = client.post(RECIPES_URL, json=recipe_payload(isPublic=True), headers=owner.headers)
    assert res.status_code == 201, res.text
    recipe_id = res.json()["id"]
    assert client.post(f"{USERS_URL}/{owner.id}/follow", headers=viewer.headers).status_code == 204

    new_name = f"testuser_{uuid.uuid4().hex[:10]}"
    assert _patch(client, owner, {"displayName": new_name}).status_code == 200

    assert _self(client, owner)["displayName"] == new_name
    assert _profile(client, viewer, owner)["displayName"] == new_name

    detail = client.get(f"{RECIPES_URL}/{recipe_id}", headers=viewer.headers).json()
    assert detail["author"]["displayName"] == new_name

    assert _find_in_feed(client, viewer, recipe_id)["author"]["displayName"] == new_name

    mine = client.get(f"{USERS_URL}/me/recipes", headers=owner.headers).json()["items"]
    assert [item["author"]["displayName"] for item in mine] == [new_name]

    following = client.get(f"{USERS_URL}/me/following", headers=viewer.headers).json()["items"]
    assert [row["displayName"] for row in following] == [new_name]
