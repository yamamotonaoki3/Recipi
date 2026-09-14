"""`password_reset_attempts` テーブルに対応するモデル。

パスワードリセットの総当たり攻撃を防ぐための簡易なレート制限に使う。
`/auth/password-reset/request` の呼び出し（成功も含む）と `/confirm` の失敗のたびに
1 行 INSERT し、直近 15 分の件数が閾値を超えたら 429 を返す（app/api/auth.py 参照）。

メール・IP という個人情報を含み、users への外部キーが無い（アカウント削除でも消えない）
ので、作られてから 1 日で掃除ジョブが消す（app/jobs/cleanup_password_reset_attempts.py。
Issue #85）。そのジョブが `created_at` で探すので、`created_at` にもインデックスを張る。

閾値・時間枠は auth.md 未確定（todo #16）につき暫定値。Redis 等の追加
インフラを避け、単一インスタンス構成でも動く DB ベースの方式にしている。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class PasswordResetAttempt(SQLModel, table=True):
    __tablename__ = "password_reset_attempts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 失敗した confirm / request リクエストのメールアドレス（正規化済み）。
    email: str = Field(nullable=False, index=True)

    # 呼び出し元の IP アドレス。email だけを制限すると、攻撃者が候補の
    # メールアドレスを 1 回ずつ変えて総当たりすれば閾値に達しないまま
    # アカウントを列挙できてしまう。IP 単位でも別途カウントすることで、
    # 同一クライアントからの大量試行そのものを頭打ちにする。
    ip_address: str = Field(nullable=False, index=True)

    created_at: datetime = Field(default_factory=_utcnow, nullable=False, index=True)
