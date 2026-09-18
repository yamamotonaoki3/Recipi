"""AI 校正 API。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.ai import ProofreadError, get_proofread_provider, proofread_in_sections
from app.config import settings
from app.db import get_session
from app.dependencies import get_current_user
from app.errors import ErrorEnvelope, too_many_requests, unavailable
from app.models.ai_usage import AIUsage
from app.models.user import User
from app.schemas.ai import ProofreadRequest, ProofreadResponse

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


def _window(kind: str, now: datetime) -> tuple[datetime, int]:
    if kind == "hour":
        return now.replace(minute=0, second=0, microsecond=0), settings.AI_HOURLY_LIMIT
    return now.replace(hour=0, minute=0, second=0, microsecond=0), settings.AI_DAILY_LIMIT


def _select_usage(
    session: Session, user_id: uuid.UUID, kind: str, start: datetime
) -> AIUsage | None:
    """この時間枠の行を取得し、コミットまで他のリクエストを待たせる（行ロック）。"""
    # SQLModel のモデル属性は mypy には素の型（str / datetime）に見えるため、`==` の
    # 結果が bool 扱いになり and_() の引数型が合わない。実行時は InstrumentedAttribute
    # なので正しい SQL 条件になる（app/api/units.py の order_by と同種の既知の誤検知）。
    return session.exec(
        select(AIUsage)
        .where(
            and_(
                AIUsage.user_id == user_id,  # type: ignore[arg-type]
                AIUsage.window_kind == kind,  # type: ignore[arg-type]
                AIUsage.window_start == start,  # type: ignore[arg-type]
            )
        )
        .with_for_update()
    ).first()


def _lock_or_create_usage(
    session: Session, user_id: uuid.UUID, kind: str, start: datetime
) -> AIUsage:
    """行が無ければ作る。同時に作ろうとして衝突したら、相手の行を読み直す（Issue #199）。

    新しい時間枠（hour / day）の最初のリクエストが同時に 2 本来ると、両方が
    「行が無い」と判断して同じ一意キー（`uq_ai_usage_user_window`）で INSERT し、
    片方が一意制約違反になる。そのまま流すと**回数制限の 429 ではなく 500** になる。
    さらに一意制約違反（23505）は `app/db.py` の `run_with_retry` の対象外なので、
    再試行でも救われない。

    そこで INSERT を SAVEPOINT の中で行う。衝突しても SAVEPOINT だけが巻き戻るため、
    このトランザクションを捨てずに、相手が作った行を読み直して処理を続けられる。
    """
    row = _select_usage(session, user_id, kind, start)
    if row is not None:
        return row
    try:
        with session.begin_nested():
            row = AIUsage(user_id=user_id, window_kind=kind, window_start=start, count=0)
            session.add(row)
            session.flush()
        return row
    except IntegrityError:
        existing = _select_usage(session, user_id, kind, start)
        if existing is None:
            # 一意制約違反なのに行が無いのは想定外。握りつぶさず元の例外を上げる。
            raise
        return existing


def _consume_quota(session: Session, user_id: uuid.UUID, now: datetime) -> None:
    rows: list[AIUsage] = []
    for kind in ("hour", "day"):
        start, limit = _window(kind, now)
        row = _lock_or_create_usage(session, user_id, kind, start)
        if row.count >= limit:
            raise too_many_requests(
                "AI校正の利用回数上限に達しました。しばらくしてからお試しください"
            )
        rows.append(row)
    for row in rows:
        row.count += 1
        session.add(row)


@router.post(
    "/proofread",
    response_model=ProofreadResponse,
    responses={
        401: {"model": ErrorEnvelope},
        429: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    summary="レシピ本文の誤字脱字を校正する",
)
def proofread(
    body: ProofreadRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ProofreadResponse:
    _consume_quota(session, current_user.id, datetime.now(UTC))
    # 外部の AI プロバイダを呼ぶ前に、回数の加算をここで確定させる。理由は 2 つ。
    #
    # 1. `get_session` の自動コミットは**レスポンスを送り終えた後**に走る
    #    （app/db.py の説明）。ここで commit しないと、200 を受け取った直後の
    #    次のリクエストが**古いカウントを読んで上限を超えられる**。
    # 2. `_consume_quota` は `with_for_update()` で行をロックしている。
    #    プロバイダ呼び出しは最大 `AI_PROVIDER_TIMEOUT_SECONDS` かかるため、
    #    commit せずに進むとその間ロックを持ち続け、同じユーザーの他の
    #    リクエストを待たせてしまう。
    #
    # なお、この後プロバイダが失敗して 503 になっても加算は戻さない。
    # 失敗も 1 回として数えることで、過負荷のときに叩き続けられないようにする。
    session.commit()
    items = [item for item in body.items if item.text.strip()]
    if not items:
        return ProofreadResponse(suggestions=[])
    try:
        suggestions = proofread_in_sections(get_proofread_provider(), items)
    except ProofreadError as exc:
        raise unavailable("AI校正サービスを利用できません") from exc
    return ProofreadResponse(suggestions=suggestions)
