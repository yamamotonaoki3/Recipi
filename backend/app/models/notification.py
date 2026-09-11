"""`notifications` テーブルに対応するモデル（features/notification.md §4）。

「自分に関係する出来事」を 1 行 = 1 通知で持つ。アプリ内通知のみで、
プッシュ通知・メール通知は対象外。

## 4 種類の通知

| `type` | 発生イベント | 受信者（`user_id`） | 行為者（`actor_id`） |
| --- | --- | --- | --- |
| `followed` | A が B をフォロー | B | A |
| `recipe_favorited` | A がレシピ R をお気に入り | R の投稿者 | A |
| `recipe_commented` | A がレシピ R に感想を投稿 | R の投稿者 | A |
| `followee_new_recipe` | A が公開レシピ R を投稿 | A のフォロワー全員 | A |

上 3 つは**単一行**なので発火元と同じトランザクションで INSERT する（軽いうえ、
「フォローは成立したのに通知が無い」という食い違いが構造的に起きない）。
`followee_new_recipe` だけはフォロワー数だけ行が増える **fan-out** なので、
リクエストの内側では作らず outbox 経由で非同期に配る
（processing-model.md §3・§7。実装は Phase 8 の Issue）。

## この Issue（#66）での範囲

テーブルと「単一行の通知を作るヘルパー」（app/services/notification.py）まで。
一覧 API（`GET /notifications`）と fan-out は Phase 8 の Issue で足す。
`comment_id` 列は Issue #66 の時点では参照先の `recipe_comments` が無く作れなかった
ため、感想の Issue #69 で追加した。

## `read_at` が NULL = 未読

「未読フラグ」ではなく「既読になった時刻」を持つ。いつ読んだかが分かるうえ、
`WHERE read_at IS NULL` の**部分インデックス**で未読件数を安く数えられる
（既読は通常どんどん増えるので、索引に含めない方が小さく保てる）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

# 通知の種別。DB 側は文字列 ＋ CHECK 制約で表現する（Upload.status と同じ方針。
# Enum 型にすると値を増やすたびに ALTER TYPE が要る）。
NotificationType = Literal[
    "followed",
    "recipe_favorited",
    "recipe_commented",
    "followee_new_recipe",
]

NOTIFICATION_TYPES: tuple[str, ...] = (
    "followed",
    "recipe_favorited",
    "recipe_commented",
    "followee_new_recipe",
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Notification(SQLModel, table=True):
    __tablename__ = "notifications"
    __table_args__ = (
        sa.CheckConstraint(
            "type IN ('followed', 'recipe_favorited', 'recipe_commented', 'followee_new_recipe')",
            name="ck_notifications_type",
        ),
        # 一覧は「自分あてを新しい順」。並び順まで索引に含めるとソートを省ける。
        sa.Index("ix_notifications_user_id_created_at", "user_id", sa.text("created_at DESC")),
        # 未読件数（バッジ）用の部分インデックス。既読行を含めないので小さく保てる。
        sa.Index(
            "ix_notifications_user_id_unread",
            "user_id",
            postgresql_where=sa.text("read_at IS NULL"),
        ),
        # 行為者・レシピが消えたときの ON DELETE CASCADE 用（FK 列は自動 index されない）。
        sa.Index("ix_notifications_actor_id", "actor_id"),
        sa.Index("ix_notifications_recipe_id", "recipe_id"),
        sa.Index("ix_notifications_comment_id", "comment_id"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 受信者。この人の通知一覧に出る。
    user_id: uuid.UUID = Field(foreign_key="users.id", nullable=False, ondelete="CASCADE")

    type: str = Field(nullable=False)

    # 行為者（「〇〇さんが〜しました」の〇〇）。退会したら通知ごと消える。
    actor_id: uuid.UUID = Field(foreign_key="users.id", nullable=False, ondelete="CASCADE")

    # 遷移先のレシピ。`followed` では NULL。
    recipe_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="recipes.id",
        nullable=True,
        ondelete="CASCADE",
    )

    # 感想の通知（`recipe_commented`）で、どの感想かを指す（Issue #69 で追加）。
    # 他の種類では NULL。感想が消えたら通知も消える（ON DELETE CASCADE）。
    comment_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="recipe_comments.id",
        nullable=True,
        ondelete="CASCADE",
    )

    # NULL = 未読。既読化した時刻を入れる。
    read_at: datetime | None = Field(default=None, nullable=True)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
