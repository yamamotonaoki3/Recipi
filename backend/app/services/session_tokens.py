"""リフレッシュトークンの発行（Issue #241 で切り出し）。

元は `app/api/auth.py` のモジュール私有だったが、`PUT /users/me/email`
（メールアドレス変更で全セッションを作り直す）からも必要になったので出した。
2 か所に同じ発行処理を書くと、有効期限やチェーンの扱いが将来ずれる。**挙動は変えていない。**

「どう運ぶか」（本文 / Cookie）は `app/auth_transport.py`、
「何を発行するか」（DB に書く行）はここ、という分担。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.config import settings
from app.models.refresh_token import RefreshToken
from app.security import generate_refresh_token, hash_refresh_token

# 「ログインを保持」OFF 時のリフレッシュトークン有効期限（暫定値・todo #16）。
# auth.md §8 で具体的な日数は未確定。ここでは「アプリを再起動したら
# 再ログインが必要」という要件の意図を汲み、1 日という短い値にしている。
REMEMBER_ME_OFF_TTL_DAYS = 1


def issue_refresh_token(
    session: Session, user_id: uuid.UUID, chain_id: uuid.UUID, remember_me: bool = True
) -> str:
    """新しいリフレッシュトークンを 1 本発行して DB に保存し、生トークンを返す。

    `remember_me` に応じて有効期限を変える（processing-model.md §6:
    「login: refresh_tokens INSERT（rememberMe で有効期限を調整）」）。
    永続化するかどうか自体はクライアントの責務だが、サーバー側の有効期限も
    それに合わせて短くしておくことで、OFF 時に古いトークンが漏れても
    長期間使えてしまわないようにする。

    `chain_id` は呼び出し側が決める。**既存のセッションを全て失効させた直後に
    発行するときは、必ず新しい `uuid.uuid4()` を渡すこと。** 古いチェーンを
    引き継ぐと、失効前のトークンが再提示されたときに `refresh()` のリユース
    検知が働き、今発行したトークンまで巻き添えで失効する（Issue #241）。
    """
    raw_token = generate_refresh_token()
    ttl_days = settings.REFRESH_TOKEN_TTL_DAYS if remember_me else REMEMBER_ME_OFF_TTL_DAYS
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(raw_token),
            chain_id=chain_id,
            expires_at=datetime.now(UTC) + timedelta(days=ttl_days),
            remember_me=remember_me,
        )
    )
    return raw_token
