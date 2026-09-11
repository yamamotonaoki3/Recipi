"""フォロー / フォロワー関連のリクエスト・レスポンススキーマ。

`GET /users/{id}/following` と `GET /users/{id}/followers` は、どちらも
「ユーザー行の一覧」という同じ形を返す（features/follow.md §5）。
画面側もフォロー・フォロワー画面の 2 タブで同じ行コンポーネントを使うため、
スキーマも 1 つに揃える。
"""

from __future__ import annotations

import uuid

from pydantic import SerializerFunctionWrapHandler, model_serializer

from app.schemas.base import CamelModel
from app.schemas.user import UserMeResponse


class UserRow(CamelModel):
    """一覧の 1 行（アバター + 表示名 + フォロー状態ボタン）。"""

    id: uuid.UUID
    display_name: str

    # `users.avatar_key` から組み立てた表示用 URL。アバターが無ければ null。
    avatar_url: str | None = None

    # **閲覧者（＝ リクエストした人）から見て**この行のユーザーをフォロー中か。
    # 一覧の持ち主から見た状態ではないので注意（フォロワー一覧では
    # 「フォローバックできるか」の判定に使う。follow.md §5）。
    is_following: bool


class UserRowListResponse(CamelModel):
    items: list[UserRow]
    next_cursor: str | None


class UserSelfProfileResponse(UserMeResponse):
    """`GET /users/{id}` で**自分自身**を取得したときの形（features/profile.md §5）。

    本人には全項目 ＋ 各公開トグルの状態を返す（プロフィール編集画面で使う）。
    設定項目は `UserMeResponse` と同じなので継承し、フォロー数を足す。
    """

    following_count: int
    follower_count: int

    # 自分を自分でフォローする概念は無いので、本人取得では常に null
    # （profile.md §5 の本人取得例）。
    is_following: None


class ProfileLinks(CamelModel):
    """他人向けプロフィールの SNS リンク。**公開 ON かつ値があるものだけ**入る。

    どの項目も既定値 `None` にしておくのが大事。既定値が無いと Pydantic は
    OpenAPI でこれらを「必須」と宣言してしまい、「必須と言いながら実際には
    返さない」契約の矛盾になる（生成される frontend の型も食い違う）。
    """

    x: str | None = None
    instagram: str | None = None
    other: str | None = None

    # 戻り値の型注釈は付けない。付けると Pydantic が OpenAPI のスキーマを
    # 「任意の dict」に置き換えてしまい、項目の定義が消える。
    @model_serializer(mode="wrap")
    def _drop_unset_links(self, handler: SerializerFunctionWrapHandler):  # type: ignore[no-untyped-def]
        # `handler(self)` は Pydantic 本来のシリアライズ（alias などの設定込み）。
        # その結果から値の無いキーを取り除く。
        data = handler(self)
        return {key: value for key, value in data.items() if value is not None}


class UserPublicProfileResponse(CamelModel):
    """`GET /users/{id}` で**他人**を取得したときの形（features/profile.md §5）。

    ## 公開 OFF の項目は「null」ではなく「キーごと無し」

    non-functional.md「データの可視性ルール」は、公開トグル OFF の項目を
    **レスポンスに含めない**ことを求めている。`"email": null` と返すと
    「メールは設定されているが非公開」という事実まで伝わってしまうため、
    キーそのものを落とす。
    - `email`: `emailPublic` が ON のときだけキーを出す
    - `links`: 常に返す（空なら `{}`）。中身は公開 ON かつ値ありの SNS だけ
    - 公開トグルの状態（`emailPublic` など）や URL の生の項目は、他人には一切返さない

    `avatarUrl` は公開トグルの対象ではないので、無いときも null で常に返す。
    """

    id: uuid.UUID
    display_name: str
    avatar_url: str | None
    following_count: int
    follower_count: int

    # 閲覧者がこのユーザーをフォローしているか（他人なので必ず true / false）。
    is_following: bool

    # 既定値 `None` の理由は `ProfileLinks` のコメントと同じ（OpenAPI で任意にするため）。
    email: str | None = None
    links: ProfileLinks

    # 戻り値の型注釈を付けない理由も `ProfileLinks` と同じ。
    @model_serializer(mode="wrap")
    def _drop_hidden_email(self, handler: SerializerFunctionWrapHandler):  # type: ignore[no-untyped-def]
        # 自前で dict を組み立てたり `self.model_dump()` を呼んだりすると、
        # camelCase への変換（alias）が効かなくなる。必ず `handler(self)` の結果を加工する。
        data = handler(self)
        if data.get("email") is None:
            data.pop("email", None)
        return data
