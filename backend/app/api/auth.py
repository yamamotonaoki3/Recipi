"""`/api/v1/auth/*` エンドポイント（サインアップ・ログイン・トークン更新等）。

トランザクション境界（processing-model.md §6）:
- 1 リクエスト = 1 トランザクション。書き込みを終えたら、レスポンスを
  組み立てる（`return` する）前に必ず `session.commit()` を明示的に呼ぶ。
- なぜ `get_session`（`app/db.py`）の自動コミットに任せないのか:
  FastAPI は `Depends(...)` に `yield` を使う依存性を渡すと、`yield` より
  後ろのコード（`get_session` 内の自動 commit）を「レスポンスをクライアント
  に送信し終えた後」に実行する（ストリーミングレスポンス等でセッションを
  生かしておくための仕様）。そのため自動コミットだけに頼ると、「クライアント
  が成功レスポンスを受け取った時点では、まだ DB への書き込みが確定して
  いない」という競合状態が起きうる（例: パスワードリセット成功の直後に
  古いアクセストークンでアクセスすると、ごく短い時間だけ 401 にならず
  通ってしまう）。`session.commit()` は普通の 1 行のコードなので、
  `return` より前に書けば Python の実行順序としてそこで必ず確定する。
  `get_session` 側の自動コミットは、書き忘れたときの保険として残す。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.config import settings
from app.db import get_session
from app.dependencies import get_current_user
from app.errors import (
    ErrorEnvelope,
    conflict,
    not_found,
    too_many_requests,
    unauthorized,
    validation_error,
)
from app.models.password_reset_attempt import PasswordResetAttempt
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    AuthTokenResponse,
    LoginRequest,
    LogoutRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequestRequest,
    PasswordResetRequestResponse,
    RefreshRequest,
    RefreshResponse,
    SignupRequest,
    UserPublic,
)
from app.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    hash_security_answer,
    verify_password_or_dummy,
    verify_security_answer,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """`@router.post(..., responses=...)` に渡す openapi.json 用の応答定義。

    デフォルトでは FastAPI は 422（バリデーションエラー）以外のエラー応答を
    openapi.json に書いてくれない。ここで各エンドポイントが実際に返しうる
    ステータス（401/404/409/429 等）を明示し、生成されるフロントの型に
    その分岐が正しく含まれるようにする（api.md「統一エラーレスポンス」）。
    """
    return {code: {"model": ErrorEnvelope} for code in status_codes}


# パスワードリセットの試行回数ロック（暫定値・todo #16）:
# 同一メールアドレスで直近 15 分に 5 回失敗したら 429 にする。
_RESET_LOCKOUT_WINDOW = timedelta(minutes=15)
_RESET_LOCKOUT_MAX_ATTEMPTS = 5

# メールアドレスだけを制限すると、攻撃者が候補のメールアドレスを 1 回ずつ
# 変えて総当たりすれば閾値に達しないままアカウントを列挙できてしまう。
# 同一 IP からの試行数にも別途上限を設ける（正当な利用でも同じ IP から
# 複数アカウントを操作しうるため、メールより緩めの閾値にする）。
_IP_LOCKOUT_MAX_ATTEMPTS = 20

# 「ログインを保持」OFF 時のリフレッシュトークン有効期限（暫定値・todo #16）。
# auth.md §8 で具体的な日数は未確定。ここでは「アプリを再起動したら
# 再ログインが必要」という要件の意図を汲み、1 日という短い値にしている。
_REMEMBER_ME_OFF_TTL_DAYS = 1


def _client_ip(request: Request) -> str:
    """レート制限のキーに使う呼び出し元 IP アドレス。

    既知の限界（暫定仕様・todo #16）: リバースプロキシ / ロードバランサ
    配下で動かす場合、`request.client.host` はプロキシ自身のアドレスに
    なり、全ユーザーが同じ IP バケットを共有してしまう（本番デプロイ先や
    プロキシ構成は未確定のため、`X-Forwarded-For` 等をここで信頼するのは
    見送る。信頼するプロキシの IP 範囲が決まってから対応する）。
    """
    return request.client.host if request.client is not None else "unknown"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _issue_refresh_token(
    session: Session, user_id: uuid.UUID, chain_id: uuid.UUID, remember_me: bool = True
) -> str:
    """新しいリフレッシュトークンを 1 本発行して DB に保存し、生トークンを返す。

    `remember_me` に応じて有効期限を変える（processing-model.md §6:
    「login: refresh_tokens INSERT（rememberMe で有効期限を調整）」）。
    OFF 時の具体的な日数は auth.md §8 で未確定（→ todo.md）につき、
    ここでは "端末再起動をまたいでは残らない程度" の暫定的に短い値を使う。
    """
    raw_token = generate_refresh_token()
    ttl_days = settings.REFRESH_TOKEN_TTL_DAYS if remember_me else _REMEMBER_ME_OFF_TTL_DAYS
    refresh_token = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_token),
        chain_id=chain_id,
        expires_at=_utcnow() + timedelta(days=ttl_days),
        remember_me=remember_me,
    )
    session.add(refresh_token)
    return raw_token


def _auth_response(session: Session, user: User, raw_refresh_token: str) -> AuthTokenResponse:
    access_token = create_access_token(user.id, user.token_version)
    return AuthTokenResponse(
        user=UserPublic(id=user.id, display_name=user.display_name),
        access_token=access_token,
        refresh_token=raw_refresh_token,
    )


@router.post("/signup", status_code=status.HTTP_201_CREATED, responses=_error_responses(409))
def signup(body: SignupRequest, session: Session = Depends(get_session)) -> AuthTokenResponse:
    existing = session.exec(select(User).where(User.email == body.email)).first()
    if existing is not None:
        raise conflict("このメールアドレスは既に登録されています")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        security_question=body.security_question,
        security_answer_hash=hash_security_answer(body.security_answer),
    )
    session.add(user)
    try:
        session.flush()  # user.id を確定させる（refresh_tokens.user_id で使うため）
    except IntegrityError as exc:
        # 事前の重複チェック（85 行目）と INSERT の間に、別リクエストが同じ
        # メールアドレスで先に登録を終えてしまう競合状態がありうる。
        # その場合は users.email の UNIQUE 制約違反になるので、素直に 409 にする。
        session.rollback()
        raise conflict("このメールアドレスは既に登録されています") from exc

    raw_refresh_token = _issue_refresh_token(session, user.id, chain_id=uuid.uuid4())
    session.commit()
    return _auth_response(session, user, raw_refresh_token)


@router.post("/login", responses=_error_responses(401))
def login(body: LoginRequest, session: Session = Depends(get_session)) -> AuthTokenResponse:
    user = session.exec(select(User).where(User.email == body.email)).first()
    # 「メールが見つからない」と「パスワードが違う」を区別しない
    # （どちらのケースでも同じ 401 を返すことで、メールアドレスの
    # 登録有無を第三者に推測されないようにする＝enumeration 対策）。
    # `verify_password_or_dummy` を使うことで、ユーザーが見つからない場合も
    # 見つかった場合と同じだけ Argon2 の検証処理を必ず走らせる（応答時間の
    # 差からメールアドレスの登録有無を推測されるタイミング攻撃を防ぐ）。
    password_hash = user.password_hash if user is not None else None
    if not verify_password_or_dummy(body.password, password_hash):
        raise unauthorized("メールアドレスまたはパスワードが正しくありません")
    # ここまで来た時点で user は必ず存在する
    # （verify_password_or_dummy は password_hash が None なら常に False を
    # 返すので、上の if で 401 になっていない = user is not None）。
    assert user is not None

    # rememberMe でリフレッシュトークンの有効期限を調整する
    # （processing-model.md §6）。永続化するかどうか自体はフロントエンド
    # （#36）の責務だが、サーバー側の有効期限もそれに合わせて短くしておく
    # ことで、OFF 時に古いトークンが漏れても長期間使えてしまわないようにする。
    raw_refresh_token = _issue_refresh_token(
        session, user.id, chain_id=uuid.uuid4(), remember_me=body.remember_me
    )
    session.commit()
    return _auth_response(session, user, raw_refresh_token)


@router.post("/refresh", responses=_error_responses(401))
def refresh(body: RefreshRequest, session: Session = Depends(get_session)) -> RefreshResponse:
    token_hash = hash_refresh_token(body.refresh_token)

    # まずロック無しでトークンの存在と所有者（user_id）だけ確認する。
    # ロックする順番を「常にユーザー行 → トークン行」に統一するため
    # （password_reset_confirm も同じ順序でロックする）。順序がバラバラだと、
    # 互いのロックを取り合ってデッドロックする可能性がある。
    unlocked_peek = session.exec(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).first()
    if unlocked_peek is None:
        raise unauthorized("リフレッシュトークンが無効です")

    # ユーザー行をロックする: パスワードリセット（password_reset_confirm も
    # 同じユーザー行をロックする）と同時に実行された場合、どちらかが終わる
    # まで待たせる。これが無いと、パスワードリセットが「既存のリフレッシュ
    # トークンを全部失効させた」直後に、ロック前に読み込んでいたこの
    # refresh リクエストが新しいトークンを発行してしまい、リセット後も
    # 有効なセッションが残ってしまう（P1: リセットとリフレッシュの競合）。
    user = session.get(User, unlocked_peek.user_id, with_for_update=True)
    if user is None:
        raise unauthorized("リフレッシュトークンが無効です")

    # ユーザー行のロックを取った後で、トークン行をロック付きで読み直す。
    # `unlocked_peek` は既にこのセッションの identity map に載っているため、
    # 同じ id を単純に select し直しても SQLAlchemy はキャッシュ済みの
    # Python オブジェクトをそのまま返し、DB の最新値（revoked_at 等）で
    # 上書きしない。`session.refresh(..., with_for_update=True)` を使うと
    # 行ロックを取りながら属性を DB の値で強制的に上書きできる。
    token_row = unlocked_peek
    session.refresh(token_row, with_for_update=True)

    if token_row.revoked_at is not None:
        # 既に失効済み（＝一度使われた）トークンが再提示された。
        # 盗用されたトークンが使われている可能性があるとみなし、
        # 同じ chain_id のトークンを全部（まだ有効なものも）失効させる。
        now = _utcnow()
        chain_tokens = session.exec(
            select(RefreshToken).where(
                RefreshToken.chain_id == token_row.chain_id,
                RefreshToken.revoked_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()
        for t in chain_tokens:
            t.revoked_at = now
            session.add(t)
        # ここで raise すると get_session が rollback してしまい、せっかくの
        # チェーン失効が消えてしまう。先に commit してから 401 を返す。
        session.commit()
        raise unauthorized("リフレッシュトークンの再利用を検知しました。再度ログインしてください")

    if token_row.expires_at < _utcnow():
        raise unauthorized("リフレッシュトークンの有効期限が切れています")

    # ローテーション: 古いトークンを失効させ、同じ chain_id で新しいトークンを発行する。
    # remember_me はチェーン全体で引き継ぐ（ログイン時に選んだ有効期限方針を
    # ローテーションのたびに変えない）。
    token_row.revoked_at = _utcnow()
    session.add(token_row)
    raw_refresh_token = _issue_refresh_token(
        session, user.id, chain_id=token_row.chain_id, remember_me=token_row.remember_me
    )
    access_token = create_access_token(user.id, user.token_version)
    session.commit()
    return RefreshResponse(access_token=access_token, refresh_token=raw_refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, responses=_error_responses(401))
def logout(
    body: LogoutRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    token_hash = hash_refresh_token(body.refresh_token)
    token_row = session.exec(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    ).first()
    # 存在しない/既に失効済みのトークンでのログアウトはエラーにしない（冪等）。
    # また、他人のリフレッシュトークンを渡された場合も同様に何もしない
    # （current_user と所有者が食い違うトークンで他人のセッションを
    # 終了させられてしまう脆弱性を防ぐ。P2）。
    if token_row is None or token_row.user_id != current_user.id:
        return None

    # ユーザー行をロックする（refresh() / password_reset_confirm と同じ
    # 「ユーザー行 → トークン行」の順序）。これが無いと、このチェーン失効の
    # 直後に、ロック待ちしていない /auth/refresh が新しいトークンを発行して
    # しまい、ログアウトしたはずのセッションが実質続いてしまう。
    session.get(User, current_user.id, with_for_update=True)

    now = _utcnow()
    chain_tokens = session.exec(
        select(RefreshToken).where(
            RefreshToken.chain_id == token_row.chain_id,
            RefreshToken.revoked_at.is_(None),  # type: ignore[union-attr]
        )
    ).all()
    for t in chain_tokens:
        t.revoked_at = now
        session.add(t)
    session.commit()
    return None


def _lock_reset_key(session: Session, key: str) -> None:
    """パスワードリセット関連リクエストを、指定したキー単位で直列化する。

    これが無いと、複数リクエストが同時に来た場合「まだ閾値未満だ」と
    全員が同時に判定してしまい、実質無制限にリクエストを許してしまう
    （`pg_advisory_xact_lock` はこのトランザクションが終わるまでロックを
    保持するので、明示的な unlock は不要）。呼び出し順序（email → ip の
    順に固定）を全エンドポイントで揃えることで、ロックの取り合いによる
    デッドロックを避けている。
    """
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": key})


def _count_recent_attempts(
    session: Session, *, email: str | None = None, ip_address: str | None = None
) -> int:
    since = _utcnow() - _RESET_LOCKOUT_WINDOW
    stmt = select(PasswordResetAttempt).where(PasswordResetAttempt.created_at >= since)
    if email is not None:
        stmt = stmt.where(PasswordResetAttempt.email == email)
    if ip_address is not None:
        stmt = stmt.where(PasswordResetAttempt.ip_address == ip_address)
    return len(session.exec(stmt).all())


def _enforce_reset_rate_limit(session: Session, email: str, ip_address: str) -> None:
    """メールアドレス単位・IP アドレス単位の両方でレート制限を確認する。

    メールアドレスだけを見ると、攻撃者が候補のメールアドレスを 1 回ずつ
    変えて総当たりすれば閾値に達しないままアカウントを列挙できてしまう
    （P1 指摘）。そのため同一 IP からの総試行数にも別途上限を設ける。
    """
    _lock_reset_key(session, f"email:{email}")
    _lock_reset_key(session, f"ip:{ip_address}")
    if _count_recent_attempts(session, email=email) >= _RESET_LOCKOUT_MAX_ATTEMPTS:
        raise too_many_requests(
            "パスワードリセットの試行回数が多すぎます。しばらくしてから再度お試しください"
        )
    if _count_recent_attempts(session, ip_address=ip_address) >= _IP_LOCKOUT_MAX_ATTEMPTS:
        raise too_many_requests(
            "パスワードリセットの試行回数が多すぎます。しばらくしてから再度お試しください"
        )


@router.post("/password-reset/request", responses=_error_responses(404, 429))
def password_reset_request(
    request: Request,
    body: PasswordResetRequestRequest,
    session: Session = Depends(get_session),
) -> PasswordResetRequestResponse:
    # non-functional.md はパスワードリセット系エンドポイント全体（request も
    # 含む）にレート制限を課すことを要求している。ここを制限しないと、
    # 大量のメールアドレスを試して「登録済みかどうか」を高速に調べる
    # 総当たり（アカウント列挙）を許してしまう。
    ip_address = _client_ip(request)
    _enforce_reset_rate_limit(session, body.email, ip_address)

    # 登録済みメールへの成功呼び出しもレート制限の対象に含める。404 の
    # ケースだけを記録すると、実在するメールアドレスを知っている（または
    # 推測が当たった）攻撃者は何回でも秘密の質問を取得できてしまう
    # （P1 指摘）。呼び出し自体を毎回 1 件のログとして先に記録する。
    session.add(PasswordResetAttempt(email=body.email, ip_address=ip_address))
    session.commit()

    user = session.exec(select(User).where(User.email == body.email)).first()
    if user is None:
        # 秘密の質問方式である以上、メールアドレスの登録有無を完全には
        # 隠せない（lessons-learned に記載の既知の制約）。ここでは素直に
        # 404 を返す。
        raise not_found("このメールアドレスは登録されていません")
    return PasswordResetRequestResponse(security_question=user.security_question)


@router.post(
    "/password-reset/confirm",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_error_responses(429),
)
def password_reset_confirm(
    request: Request,
    body: PasswordResetConfirmRequest,
    session: Session = Depends(get_session),
) -> None:
    ip_address = _client_ip(request)
    _enforce_reset_rate_limit(session, body.email, ip_address)

    # ユーザー行をロックする（refresh() 側の with_for_update と対になる）。
    # これにより、このリクエストが token_version 更新・トークン全失効を
    # 終える（commit する）まで、同じユーザーの /auth/refresh を待たせる。
    user = session.exec(select(User).where(User.email == body.email).with_for_update()).first()

    # 「メールが見つからない」「秘密の質問の回答が違う」「新パスワードが不正」を
    # あえて区別せず、すべて同じ 400 にする（オラクル攻撃対策）。
    # new_password の文字数チェックを Pydantic の Field 制約にすると、
    # 他の 2 ケースとは別のエラー形式（バリデーションエラー）で 400 が
    # 返ってしまい、理由が外から見分けられてしまう。そのためここで
    # 手動チェックし、他の失敗ケースとまったく同じレスポンスにする。
    new_password_invalid = not (
        PASSWORD_MIN_LENGTH <= len(body.new_password) <= PASSWORD_MAX_LENGTH
    )
    if (
        user is None
        or not verify_security_answer(body.security_answer, user.security_answer_hash)
        or new_password_invalid
    ):
        # ここで raise すると get_session が rollback してしまい、失敗記録が
        # 消えてレート制限が効かなくなる。先に commit してから 400 を返す。
        session.add(PasswordResetAttempt(email=body.email, ip_address=ip_address))
        session.commit()
        raise validation_error("パスワードリセットに失敗しました。入力内容を確認してください")

    user.password_hash = hash_password(body.new_password)
    # token_version をインクリメントすることで、リセット前に発行済みの
    # アクセストークンを（有効期限内でも）即座に無効化する。
    user.token_version += 1
    user.updated_at = _utcnow()
    session.add(user)

    now = _utcnow()
    active_tokens = session.exec(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),  # type: ignore[union-attr]
        )
    ).all()
    for t in active_tokens:
        t.revoked_at = now
        session.add(t)

    session.commit()
    return None
