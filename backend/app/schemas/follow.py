"""フォロー / フォロワー関連のリクエスト・レスポンススキーマ。

`GET /users/{id}/following` と `GET /users/{id}/followers` は、どちらも
「ユーザー行の一覧」という同じ形を返す（features/follow.md §5）。
画面側もフォロー・フォロワー画面の 2 タブで同じ行コンポーネントを使うため、
スキーマも 1 つに揃える。
"""

from __future__ import annotations

import uuid

from app.schemas.base import CamelModel


class UserRow(CamelModel):
    """一覧の 1 行（アバター + 表示名 + フォロー状態ボタン）。"""

    id: uuid.UUID
    display_name: str

    # アバターの実体（`users.avatar_key`）はプロフィール拡張の Issue で追加する。
    # 契約を先に確定させておきたいのでフィールドだけ用意し、今は常に null を返す。
    avatar_url: str | None = None

    # **閲覧者（＝ リクエストした人）から見て**この行のユーザーをフォロー中か。
    # 一覧の持ち主から見た状態ではないので注意（フォロワー一覧では
    # 「フォローバックできるか」の判定に使う。follow.md §5）。
    is_following: bool


class UserRowListResponse(CamelModel):
    items: list[UserRow]
    next_cursor: str | None


class UserProfileResponse(CamelModel):
    """`GET /users/{id}` の最小版（features/profile.md §5）。

    アバター・メール・SNS リンク・公開トグルはプロフィール拡張の Issue で足す。
    """

    id: uuid.UUID
    display_name: str
    avatar_url: str | None = None
    following_count: int
    follower_count: int

    # 閲覧者がこのユーザーをフォローしているか。**自分自身を取得したときは null**
    # （自分を自分でフォローする概念が無いため。profile.md §5 の本人取得例）。
    is_following: bool | None
