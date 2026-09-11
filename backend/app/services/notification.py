"""通知のドメインロジック（features/notification.md）。

## この Issue（#66）での範囲

**単一行の通知を作るヘルパー**だけを置く。`GET /notifications` の一覧 API と、
`followee_new_recipe` の fan-out（outbox ＋ `BackgroundTasks`）は Phase 8 の
Issue で足す。

## なぜ「作る側」を 1 か所にまとめるか

通知を作るのはフォロー・お気に入り・感想の 3 か所（Phase 8 で 4 か所目）で、
それぞれ別のサービスから呼ばれる。共通ルールが 2 つあり、各所に散らすと
どこかで守り忘れる:

1. **自分の操作による自分あての通知は作らない**（notification.md §3）。
   例: 自分のレシピを自分でお気に入りしても通知しない。
2. **発火元と同一トランザクションで INSERT する**（processing-model.md §3）。
   1 行 INSERT で軽く、「お気に入りは成立したのに通知が無い」という
   食い違いが構造的に起きない。

このモジュールは `session.commit()` を**呼ばない**。呼び出し元（フォロー等の
サービス）のトランザクションにそのまま相乗りするための決まりで、
コミットするかどうかは呼び出し元が決める。
"""

from __future__ import annotations

import uuid

from sqlmodel import Session

from app.models.notification import Notification, NotificationType


def create_single_notification(
    session: Session,
    *,
    user_id: uuid.UUID,
    type: NotificationType,
    actor_id: uuid.UUID,
    recipe_id: uuid.UUID | None = None,
    comment_id: uuid.UUID | None = None,
) -> Notification | None:
    """単一行の通知を 1 件作る。自分あて（受信者 = 行為者）なら作らず `None`。

    呼び出し元のトランザクションに参加するだけで、コミットはしない。
    """
    if user_id == actor_id:
        # 「自分がフォローした相手 = 自分」は API 層で 400 にしているので通常は
        # 来ないが、お気に入り・感想では「自分のレシピを自分で」が正常系として
        # ありうる。判定をここに集約しておけば呼び出し側で書き忘れない。
        return None

    notification = Notification(
        user_id=user_id,
        type=type,
        actor_id=actor_id,
        recipe_id=recipe_id,
        comment_id=comment_id,
    )
    session.add(notification)
    return notification
