"""監査イベント（誰が・いつ・何を・結果どうなったか）をログに出す。

方針（docs/requirements/non-functional.md §ログ / Issue #170）:
- 監査イベントは DB のテーブルには保存せず、構造化ログ（`log_type="audit"`）
  として標準出力に出す。本番では CloudWatch Logs に集まり、Logs Insights で
  `filter log_type = "audit"` のように絞り込んで調べる。
- 「ログイン履歴」画面のように、アプリがあとから読み返す必要が出てきたら、
  この `audit_event()` の中でテーブルへの書き込みを足す（呼び出し側は変えない）。
- メールアドレスは平文で出さない。`email_hash()`（秘密鍵付きのハッシュ）で出す。
  同じアドレスは同じ値になるので「同じアドレスへの失敗が続いているか」は
  数えられるが、ログを見た人がアドレスそのものを知ることはできない。

レベル: 成功は INFO、失敗・不審な操作は WARNING（本番の LOG_LEVEL=INFO で必ず出る）。
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Literal

from app.config import settings
from app.logging_config import current_client_ip, current_user_id, set_current_user_id

logger = logging.getLogger("app.audit")

Outcome = Literal["success", "failure"]


def email_hash(email: str) -> str:
    """メールアドレスを、ログに出してよい短い識別子に変える。

    ただの SHA-256 だと、よくあるアドレスを総当たりでハッシュ化して突き合わせれば
    元に戻せてしまう。秘密鍵（LOG_HASH_SECRET）付きの HMAC にして、鍵を知らない
    人には元のアドレスを割り出せないようにする。大文字小文字の違いは同じ扱い。
    """
    normalized = email.strip().lower().encode("utf-8")
    digest = hmac.new(settings.LOG_HASH_SECRET.encode("utf-8"), normalized, hashlib.sha256)
    return digest.hexdigest()[:16]


def audit_event(
    action: str,
    outcome: Outcome,
    *,
    user_id: object | None = None,
    reason: str | None = None,
    email: str | None = None,
    **fields: object,
) -> None:
    """監査イベントを 1 行出す。

    - `action`: 何をしたか（例: "auth.login"）。一覧は non-functional.md §ログ。
    - `outcome`: "success" / "failure"。
    - `user_id`: 対象ユーザー。省略時はこのリクエストの認証済みユーザー（いなければ "-"）。
    - `reason`: 失敗の理由（例: "invalid_credentials"）。
    - `email`: 渡すと `email_hash` に変換して出す（平文は出さない）。
    - `fields`: そのほか調査に役立つ ID など（例: recipe_id）。秘密は渡さないこと。

    ログを出す処理そのものが失敗しても、ログイン等の本来の処理を失敗させない
    （CLAUDE.md「副次的な後始末はベストエフォートにする」と同じ考え方）。
    """
    try:
        extra: dict[str, object] = {
            "log_type": "audit",
            "action": action,
            "outcome": outcome,
            "client_ip": current_client_ip(),
        }
        if user_id is not None:
            extra["user_id"] = str(user_id)
            if outcome == "success" and current_user_id() == "-":
                # ログイン成功などは認証依存関数を通らないため、ここで設定しないと
                # 同じリクエストのアクセスログが未認証の "-" のままになる。
                set_current_user_id(user_id)
            # failure では user_id をリクエストに設定しない。認証されていない
            # 入力が対象ユーザーのものだと、アクセスログで誤解されるため。
        if reason is not None:
            extra["reason"] = reason
        if email is not None:
            extra["email_hash"] = email_hash(email)
        extra.update({k: str(v) for k, v in fields.items()})
        level = logging.INFO if outcome == "success" else logging.WARNING
        logger.log(level, "audit: %s %s", action, outcome, extra=extra)
    except Exception:  # 監査ログの失敗で本処理を止めない
        logging.getLogger(__name__).debug("監査ログの出力に失敗しました", exc_info=True)
