"""`app.services.notification.create_single_notification` の単体テスト（Issue #66）。

実 DB につながない（`session.add` が呼ばれたかだけを見る）ので単体テスト。
WB: 「自分あてなので作らない」分岐と「作る」分岐の両方を通す。
"""

from __future__ import annotations

import uuid
from typing import Any

from app.services.notification import create_single_notification


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[Any] = []

    def add(self, obj: Any) -> None:
        self.added.append(obj)


def test_creates_a_notification_for_someone_else() -> None:
    session = _FakeSession()
    actor = uuid.uuid4()
    recipient = uuid.uuid4()

    created = create_single_notification(
        session,  # type: ignore[arg-type]
        user_id=recipient,
        type="followed",
        actor_id=actor,
    )

    assert created is not None
    assert session.added == [created]
    assert created.user_id == recipient
    assert created.actor_id == actor
    assert created.type == "followed"
    assert created.read_at is None


def test_does_not_create_a_self_notification() -> None:
    """自分の操作による自分あての通知は作らない（notification.md §3）。

    例: 自分のレシピを自分でお気に入りしたとき。判定をこの関数に集約して
    いるので、呼び出し側（フォロー / お気に入り / 感想）で書き忘れても守られる。
    """
    session = _FakeSession()
    me = uuid.uuid4()

    created = create_single_notification(
        session,  # type: ignore[arg-type]
        user_id=me,
        type="recipe_favorited",
        actor_id=me,
        recipe_id=uuid.uuid4(),
    )

    assert created is None
    assert session.added == []
