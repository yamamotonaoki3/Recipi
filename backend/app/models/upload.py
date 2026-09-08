"""`uploads` テーブルに対応するモデル（一時アップロードの管理行）。

## なぜ「管理行」が要るのか

画像は「レシピを保存する前」にアップロードされる:

    ① POST /images   → 画像を保存して key を返す
    ② ユーザーがレシピを編集…（ここで離脱するかもしれない）
    ③ POST /recipes  → body に key を入れて保存。ここで初めて「参照される」

②で離脱すると、そのオブジェクトは誰からも参照されない「孤児」になる。
DB 側に管理行を持っておけば、「いつ・誰が上げた画像で、まだ参照されて
いないのはどれか」が分かり、あとから掃除（GC）できる。

## 状態機械（processing-model.md §9）

    pending  … 行だけ作った直後。オブジェクトはまだ保存されていない
      ↓ （オブジェクトの PUT に成功）
    stored   … 保存済み。まだレシピに紐付いていない（本参照待ち）
      ↓ （レシピの POST / PUT で参照された）
    consumed … 本参照された。GC の対象外になる

**キーはオブジェクトを置く前に行の INSERT で確定する**（`pending`）。
逆順（先に PUT）にすると「オブジェクトはあるが DB に記録が無い」状態が
でき、後から掃除する手段が無くなるため。

`expires_at` は `pending` の寿命。②のオブジェクト PUT が失敗すると行は
`pending` のまま残るので、期限を過ぎたものを GC が回収する。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

# 状態の型。DB 側は文字列 ＋ CHECK 制約で表現する（Enum 型を作ると
# 値を増やすたびに ALTER TYPE が要るため、この規模では文字列で十分）。
UploadStatus = Literal["pending", "stored", "consumed"]

UPLOAD_STATUSES: tuple[str, ...] = ("pending", "stored", "consumed")


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Upload(SQLModel, table=True):
    __tablename__ = "uploads"
    __table_args__ = (
        sa.CheckConstraint(
            "status IN ('pending', 'stored', 'consumed')",
            name="ck_uploads_status",
        ),
        sa.CheckConstraint("size_bytes >= 0", name="ck_uploads_size_bytes_non_negative"),
        # GC の OR 条件は、pending では expires_at、stored では created_at と
        # 比較する。各枝が別の列を使うため、1 本の索引で両方を効率よく引く
        # ことはできず、それぞれに status から始まる複合索引が必要になる。
        sa.Index("ix_uploads_status_expires_at", "status", "expires_at"),
        sa.Index("ix_uploads_status_created_at", "status", "created_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # アップロードした本人。アカウント削除で管理行も一緒に消える。
    # （消える前にキーを削除キューへ移す処理は Phase 9 のアカウント削除で行う）
    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        ondelete="CASCADE",
    )

    # オブジェクトストレージ上のキー（例: "uploads/1f0c….jpg"）。
    # 公開バケット運用なので、推測できないランダム値であることが重要。
    key: str = Field(nullable=False, unique=True, index=True)

    # `sa_type` を明示するのは、SQLModel が `Literal[...]` から SQL の型を
    # 自動判定できないため（Enum かどうかを調べる処理で例外になる）。
    # Python 側は Literal で 3 値に絞り、DB 側は VARCHAR ＋ CHECK 制約で守る。
    status: UploadStatus = Field(default="pending", nullable=False, sa_type=sa.String)

    # 保存したオブジェクトの Content-Type / バイト数（加工後の実値）。
    content_type: str = Field(nullable=False)
    size_bytes: int = Field(default=0, nullable=False)

    # `pending` のまま放置された行を GC が回収するための期限。
    expires_at: datetime = Field(nullable=False)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False)
