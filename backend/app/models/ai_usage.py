"""AI 校正 API のユーザー単位レート制限カウンタ。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.models._types import UTC_DATETIME


def _utcnow() -> datetime:
    return datetime.now(UTC)


class AIUsage(SQLModel, table=True):
    __tablename__ = "ai_usage"
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id", "window_kind", "window_start", name="uq_ai_usage_user_window"
        ),
        sa.Index("ix_ai_usage_window_start", "window_start"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", nullable=False, index=True)
    window_kind: str = Field(nullable=False)  # hour / day
    window_start: datetime = Field(nullable=False, sa_type=UTC_DATETIME)
    count: int = Field(default=0, nullable=False)
    created_at: datetime = Field(default_factory=_utcnow, nullable=False, sa_type=UTC_DATETIME)
