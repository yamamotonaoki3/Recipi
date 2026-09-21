"""fan-out測定で作成したレシピの outbox と通知件数を確認する（Issue #248）。

`fanout.js` のログに出た recipe_id を指定して実行する。API応答だけでなく、
別トランザクションから outbox の処理済み時刻と通知件数を確認するため、
「投稿は成功したが通知配布に失敗した」ケースを成功扱いしない。
"""

from __future__ import annotations

import argparse
import sys
import time
import uuid
from dataclasses import dataclass

from sqlalchemy import func
from sqlmodel import Session, select


@dataclass(frozen=True)
class FanoutSnapshot:
    """別トランザクションから取得した fan-out の成立条件。"""

    outbox_exists: bool
    processed: bool
    notification_count: int
    recipient_ids: frozenset[uuid.UUID]
    expected_recipient_ids: frozenset[uuid.UUID]


def validate_snapshot(snapshot: FanoutSnapshot) -> None:
    """投稿成功だけでは成立しない fan-out の成立条件を検証する。"""
    if not snapshot.outbox_exists:
        raise RuntimeError("対象 outbox がありません")
    if not snapshot.processed:
        raise RuntimeError("対象 outbox が未処理です")
    if snapshot.recipient_ids != snapshot.expected_recipient_ids:
        raise RuntimeError(
            "通知の受信者が一致しません: "
            f"expected={len(snapshot.expected_recipient_ids)} "
            f"actual={len(snapshot.recipient_ids)}"
        )
    if snapshot.notification_count != len(snapshot.expected_recipient_ids):
        raise RuntimeError(
            "通知件数が一致しません: "
            f"expected={len(snapshot.expected_recipient_ids)} "
            f"actual={snapshot.notification_count}"
        )


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="fan-out測定結果をDBで検証する")
    parser.add_argument("recipe_id", type=uuid.UUID, help="fanout.js が出力した recipe_id")
    parser.add_argument("--expected-followers", type=int, required=True)
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    return parser.parse_args(argv)


def verify(
    recipe_id: uuid.UUID,
    expected_followers: int,
    timeout_seconds: float,
    poll_seconds: float,
) -> int:
    """対象レシピの outbox 処理完了と通知件数を待ち、成功なら0を返す。"""
    if expected_followers < 0:
        raise ValueError("expected_followers は0以上にしてください")
    if timeout_seconds <= 0 or poll_seconds <= 0:
        raise ValueError("timeout_seconds と poll_seconds は正数にしてください")

    from app.db import engine
    from app.models.follow import Follow
    from app.models.notification import Notification
    from app.models.notification_outbox import NotificationOutbox

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        with Session(engine) as session:
            outbox = session.exec(
                select(NotificationOutbox).where(
                    NotificationOutbox.recipe_id == recipe_id,
                    NotificationOutbox.event == "followee_new_recipe",
                )
            ).first()
            count = int(
                session.exec(
                    select(func.count())
                    .select_from(Notification)
                    .where(
                        Notification.recipe_id == recipe_id,
                        Notification.type == "followee_new_recipe",
                    )
                ).one()
            )
            if outbox is not None and outbox.processed_at is not None:
                # 受信者集合も照合する。件数だけでは誤配信を検出できない。
                recipients = frozenset(
                    session.exec(
                        select(Notification.user_id).where(
                            Notification.recipe_id == recipe_id,
                            Notification.type == "followee_new_recipe",
                        )
                    ).all()
                )
                expected_recipients = frozenset(
                    session.exec(
                        select(Follow.follower_id).where(Follow.followee_id == outbox.author_id)
                    ).all()
                )
                validate_snapshot(
                    FanoutSnapshot(
                        outbox_exists=True,
                        processed=True,
                        notification_count=count,
                        recipient_ids=recipients,
                        expected_recipient_ids=expected_recipients,
                    )
                )
                duration = (outbox.processed_at - outbox.created_at).total_seconds()
                print(
                    f"recipe_id={recipe_id} notifications={len(recipients)} "
                    f"outbox_seconds={duration:.3f} recipient_check=available"
                )
                return 0
        time.sleep(poll_seconds)

    raise TimeoutError(f"outboxの処理完了を{timeout_seconds:.1f}秒待ちました")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return verify(
            args.recipe_id,
            args.expected_followers,
            args.timeout_seconds,
            args.poll_seconds,
        )
    except (ValueError, RuntimeError, TimeoutError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
