from __future__ import annotations

import uuid

import pytest

from scripts.verify_fanout import FanoutSnapshot, validate_snapshot


def _snapshot(**overrides: object) -> FanoutSnapshot:
    follower = uuid.uuid4()
    values: dict[str, object] = {
        "outbox_exists": True,
        "processed": True,
        "notification_count": 1,
        "recipient_ids": frozenset({follower}),
        "expected_recipient_ids": frozenset({follower}),
    }
    values.update(overrides)
    return FanoutSnapshot(**values)  # type: ignore[arg-type]


def test_validates_processed_outbox_and_exact_recipients() -> None:
    validate_snapshot(_snapshot())


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"outbox_exists": False}, "outbox"),
        ({"processed": False}, "未処理"),
        ({"recipient_ids": frozenset()}, "受信者"),
        ({"notification_count": 0}, "通知件数"),
    ],
)
def test_rejects_invalid_measurement(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(RuntimeError, match=message):
        validate_snapshot(_snapshot(**overrides))
