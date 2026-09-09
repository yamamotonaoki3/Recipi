"""`recipe_views` テーブルに対応するモデル（features/view-history.md §4）。

「ユーザーがどのレシピをいつ最後に見たか」を 1 行 = 1（ユーザー × レシピ）で
持つ。同じレシピを何度見ても行は増やさず `viewed_at` だけ更新する（upsert）。
サーバー保存なので、同じアカウントなら別端末でも同じ履歴が見える。

なぜ複合主キー `(user_id, recipe_id)` にするか:
- 「レシピごとに最新の閲覧時刻 1 つ」だけ分かればよく、閲覧のたびに履歴行を
  積み上げる必要がない（積み上げると一覧の重複排除が要る）。
- 主キー自体を `ON CONFLICT` の対象にできるので、「無ければ挿入 / 有れば時刻更新」を
  1 つの SQL 文で書ける（app/services/history.py の record_view 参照）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RecipeView(SQLModel, table=True):
    __tablename__ = "recipe_views"
    __table_args__ = (
        # 履歴一覧は「自分の行を viewed_at の新しい順」で引く。この並びを
        # index なしでやると毎回フルスキャン + ソートになるので、
        # (user_id, viewed_at DESC) の複合 index を張っておく。
        sa.Index("ix_recipe_views_user_id_viewed_at", "user_id", sa.text("viewed_at DESC")),
        # レシピ削除時、`recipe_id` の FK 経由で ON DELETE CASCADE がこの表の行を探す。
        # PostgreSQL は FK 列を自動では index しないため、これが無いと 1 レシピ削除の
        # たびに recipe_views 全体をスキャンする（表は閲覧のたびに増える）。favorites
        # 表と同じ考え方で、逆方向の index を明示する（data-model.md）。
        sa.Index("ix_recipe_views_recipe_id", "recipe_id"),
    )

    # レシピ / ユーザーが消えたら閲覧履歴の行も一緒に消す（ON DELETE CASCADE）。
    # 履歴は「今存在するレシピ」に対してだけ意味があるため。
    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        ondelete="CASCADE",
        primary_key=True,
    )
    recipe_id: uuid.UUID = Field(
        foreign_key="recipes.id",
        ondelete="CASCADE",
        primary_key=True,
    )

    # timestamptz（タイムゾーン付き）で持つ。列の timezone=True 指定は
    # マイグレーション側で行う（既存モデルと同じ方針。data-model.md「DB を正とする」）。
    viewed_at: datetime = Field(default_factory=_utcnow, nullable=False)
