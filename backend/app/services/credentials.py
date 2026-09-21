"""認証情報の変更（現パスワードでの再認証を伴う操作）のドメインロジック。

Issue #240 で秘密の質問・答えの変更を、Issue #241 でメールアドレスの変更を扱う。

## トランザクションの区切り方（ここが肝心）

`session.commit()` は**トランザクション全体を確定し、取得済みの行ロックも解放する**。
そのため「レート制限の記録だけ確定して、ユーザー行のロックは保持し続ける」ことはできない。
次の順に分ける。ルーター（app/api/users.py）が commit を 2 回書くのは、この区切りを
呼び出し側から見えるようにするため。

1. `consume_reauth_quota()` … 枠を確認して記録を `add` する。**ルーターが commit する。**
   ここで取るのは advisory ロックと、外部キー検査ぶんの `FOR KEY SHARE` だけ。
   `FOR UPDATE` は取らない。
2. `reauthenticate()` … ユーザー行を `FOR UPDATE` でロックして読み直し、退会・世代・
   パスワードを確かめる。
3. `change_security_question()` … 値を書き換える。**ルーターが commit する。**
   2 と 3 の間に commit を挟まない（挟むとロックが外れて競合する）。

## ロックの順序

既存のパスワードリセット（app/api/auth.py）は `email advisory → ip advisory → users 行`
の順に取る。こちらは `reauth advisory（user → ip）→ commit で解放 → users 行` の順で、
行ロックを取る時点で advisory ロックを持っていない。さらに advisory ロックは 2 引数形式の
専用 namespace（`ADVISORY_NS_REAUTH`）を使うので、リセット側の 1 引数形式とキー空間が
分かれている。よって両者が互いのロックを待ち合う循環はできない。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import InvalidRequestError
from sqlmodel import Session, select

from app.audit import audit_event
from app.db import ADVISORY_NS_REAUTH, advisory_xact_lock
from app.errors import reauth_failed, too_many_requests, unauthorized
from app.models.reauth_attempt import ReauthAttempt
from app.models.user import User
from app.schemas.user import ChangeSecurityQuestionRequest
from app.security import hash_security_answer, verify_password

# 直近この時間の試行回数を数える。閾値はパスワードリセット（app/api/auth.py）と同値。
_REAUTH_WINDOW = timedelta(minutes=15)
_REAUTH_MAX_ATTEMPTS_PER_USER = 5
# ユーザー単位だけだと、攻撃者が多数のアカウントに 1 回ずつ試行すれば閾値に届かない
# まま大量の Argon2 検証を走らせられる。IP 単位は、正当な利用でも同じ回線から複数
# アカウントを操作しうるため緩めにする。
_REAUTH_MAX_ATTEMPTS_PER_IP = 20

_RATE_LIMIT_MESSAGE = "操作の試行回数が多すぎます。しばらくしてから再度お試しください"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _count_recent(
    session: Session, *, user_id: uuid.UUID | None = None, ip_address: str | None = None
) -> int:
    since = _utcnow() - _REAUTH_WINDOW
    stmt = select(ReauthAttempt).where(ReauthAttempt.created_at >= since)
    if user_id is not None:
        stmt = stmt.where(ReauthAttempt.user_id == user_id)
    if ip_address is not None:
        stmt = stmt.where(ReauthAttempt.ip_address == ip_address)
    return len(session.exec(stmt).all())


def consume_reauth_quota(session: Session, *, user_id: uuid.UUID, ip_address: str) -> None:
    """再認証の枠を 1 つ使う。使い切っていたら 429。

    **呼び出し側はこの直後に `session.commit()` すること。** 記録が確定しないと
    レート制限が効かない（`get_session` は例外時に rollback するため、
    「記録してから例外を投げる」だけでは記録ごと消える）。

    **ユーザー行を `FOR UPDATE` でロックする前に呼ぶこと。** この関数は commit を
    前提にしており、先に行ロックを取っているとその commit でロックが外れてしまう。
    同じ理由で、呼び出し側に未確定の書き込みが残っている状態で呼んではいけない。

    枠を使ったと数えるのは**受け付けた試行だけ**。429 で弾いた分を記録すると、
    拒否され続けるリクエストを連打するだけでロック期間を延ばせてしまう。
    成功した試行も数えるのは、正しいパスワードを知る相手が Argon2 の検証を
    無制限に走らせられないようにするため。
    """
    # 同時に来た複数リクエストが揃って「まだ閾値未満だ」と判定しないよう直列化する。
    # 順序は user → ip に固定（取り合いによるデッドロックを避けるため）。
    advisory_xact_lock(session, f"user:{user_id}", namespace=ADVISORY_NS_REAUTH)
    advisory_xact_lock(session, f"ip:{ip_address}", namespace=ADVISORY_NS_REAUTH)

    if _count_recent(session, user_id=user_id) >= _REAUTH_MAX_ATTEMPTS_PER_USER:
        audit_event("account.reauth", "failure", reason="rate_limited_user", user_id=user_id)
        raise too_many_requests(_RATE_LIMIT_MESSAGE)
    if _count_recent(session, ip_address=ip_address) >= _REAUTH_MAX_ATTEMPTS_PER_IP:
        audit_event("account.reauth", "failure", reason="rate_limited_ip", user_id=user_id)
        raise too_many_requests(_RATE_LIMIT_MESSAGE)

    session.add(ReauthAttempt(user_id=user_id, ip_address=ip_address))


def reauthenticate(
    session: Session, user: User, raw_password: str, *, expected_token_version: int
) -> None:
    """現パスワードを確かめ、`user` を最新かつロック済みの状態にする。

    `expected_token_version` には、**このリクエストのアクセストークンが持っていた
    世代**を渡す。`get_current_user` が JWT と DB の一致を確認済みなので、呼び出し側が
    ルーターの入口で `current_user.token_version` を int として控えれば足りる。
    `session.refresh()` は同じインスタンスを書き換えてしまうため、読み直したあとの
    値どうしを比べても競合は検出できない。**必ず commit より前に控えること。**

    ここを抜けた時点で `user` の行は `FOR UPDATE` でロックされている。呼び出し側は
    書き換えを終えるまで commit しない（commit するとロックが外れる）。
    """
    try:
        # ロックと同時に DB の最新値で上書きする。ここを単なる再 select にすると、
        # identity map に残った古い値が返ってきて競合を見逃す。
        session.refresh(user, with_for_update=True)
    except InvalidRequestError:
        # ロックを待っている間に本人が退会し、行が消えた場合。
        raise unauthorized() from None

    if user.deleted_at is not None or user.token_version != expected_token_version:
        # 待っている間にパスワードリセットや退会が確定した。トークン自体が
        # もう無効なので 401（クライアントはリフレッシュを試み、それも失敗して
        # ログイン画面へ戻る。これが正しい挙動）。
        raise unauthorized()

    if not verify_password(raw_password, user.password_hash):
        audit_event("account.reauth", "failure", reason="invalid_password", user_id=user.id)
        # 401 にしない理由は app/errors.py の `reauth_failed` のコメント。
        raise reauth_failed()


def change_security_question(
    session: Session,
    user: User,
    body: ChangeSecurityQuestionRequest,
    *,
    expected_token_version: int,
) -> None:
    """秘密の質問と答えを差し替える（features/auth.md）。

    質問と答えは対で意味を持つので、常に両方を受け取って一緒に書き換える
    （片方だけ変えると「古い答えのまま質問文だけ変わる」不整合になる）。

    **commit しない。** 呼び出し側（ルーター）が行う。
    """
    reauthenticate(
        session, user, body.current_password, expected_token_version=expected_token_version
    )

    user.security_question = body.security_question
    # hash_security_answer が内部で正規化（前後空白の除去・NFKC・casefold）する。
    user.security_answer_hash = hash_security_answer(body.security_answer)
    user.updated_at = _utcnow()
    session.add(user)
