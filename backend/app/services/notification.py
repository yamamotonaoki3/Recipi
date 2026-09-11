"""通知のドメインロジック（features/notification.md）。

## このモジュールの範囲（通知の「書き込み側」）

- 単一行の通知を作るヘルパー（#66）
- `followee_new_recipe` の fan-out: outbox への登録と配布（#70）

一覧・未読数・既読化（読み取り側）は app/services/notification_feed.py に分けている。
読み取り側は投稿者の組み立て（`recipe.author_of`）を使うので `recipe.py` を import
するが、`recipe.py` はレシピ作成時にこのモジュール（outbox 登録）を import する。
このモジュールから `recipe.py` を import すると循環 import になるため、分けている。

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

import logging
import uuid

from sqlalchemy import text
from sqlmodel import Session

from app.db import engine
from app.models.notification import Notification, NotificationType
from app.models.notification_outbox import NotificationOutbox
from app.models.recipe import Recipe

logger = logging.getLogger(__name__)


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


# --- fan-out（followee_new_recipe）--------------------------------------------
#
# 流れ（processing-model.md §7・§9）:
#
# 1. 公開レシピの作成トランザクションの中で `enqueue_followee_new_recipe` が
#    outbox に 1 行書く（ここでは配らない）
# 2. コミット後、FastAPI の `BackgroundTasks` が `deliver_outbox_for_recipe` を呼ぶ
# 3. `BackgroundTasks` はプロセスが落ちると消える（メモリ上の予定にすぎない）。
#    その取りこぼしは定期スイープ（app/jobs/notification_sweep.py）が
#    「5 分以上たっても未処理の行」として拾い直す
#
# 2 と 3 が同じ行を同時に処理しようとしても、`deliver_one` の
# `FOR UPDATE SKIP LOCKED` で片方だけが取り、もう片方は待たずに飛ばす。
# 仮に二重に配っても、通知側の部分一意 index ＋ `ON CONFLICT DO NOTHING` で
# 同じ人に同じ通知は 1 件しかできない。


def enqueue_followee_new_recipe(session: Session, recipe: Recipe) -> NotificationOutbox:
    """公開レシピの作成 Tx の中で「フォロワーに配る予定」を 1 行書く。コミットはしない。

    `created_at` をレシピの作成時刻にそろえるのは、配った通知の時刻にこれを使うため
    （スイープで遅れて配っても、一覧では投稿した時刻に並ぶ）。
    """
    outbox = NotificationOutbox(
        event="followee_new_recipe",
        recipe_id=recipe.id,
        author_id=recipe.user_id,
        created_at=recipe.created_at,
    )
    session.add(outbox)
    return outbox


def deliver_one(session: Session, outbox_id: uuid.UUID) -> bool:
    """outbox 1 行ぶんを配る。処理済みにしたら True。コミットは呼び出し側。

    ## ロックの順番: users → recipes → outbox

    レシピ削除（recipes 行 → CASCADE で outbox 行）やアカウント削除（users 行 → CASCADE）
    と同じ向きにそろえて、互いに待ち合う（デッドロック）形を作らない。

    - 投稿者の users 行は `FOR KEY SHARE`（退会だけを止める一番弱いロック）
    - recipes 行は `FOR SHARE`。レシピ更新が `is_public` を書き換えるときのロックと
      ぶつかるので、**配っている最中に非公開化されることが無い**。非公開化が先に
      コミットされていれば、ロック後に読んだ `is_public = false` を見て配らない
    - outbox 行は `FOR UPDATE SKIP LOCKED`。`SKIP LOCKED` は「他の誰かが処理中なら
      待たずに飛ばす」指定で、BackgroundTasks とスイープが同時に来ても片方だけが配る

    非公開・フォロワー 0 人でも `processed_at` を入れて処理済みにする（何度も拾われない）。
    配布前に非公開化されたレシピは、後で公開に戻しても配らない（通知は「公開レシピの
    新規投稿時」だけ。notification.md §3）。
    """
    head = session.execute(
        text("SELECT recipe_id, author_id FROM notification_outbox WHERE id = :id"),
        {"id": outbox_id},
    ).first()
    if head is None:
        return False
    recipe_id, author_id = head

    author = session.execute(
        text("SELECT id FROM users WHERE id = :id FOR KEY SHARE"), {"id": author_id}
    ).first()
    if author is None:
        return False

    # ORM のオブジェクトではなく列の値だけを取るので、セッションに残った古い値を見ない。
    recipe_row = session.execute(
        text("SELECT is_public FROM recipes WHERE id = :id FOR SHARE"), {"id": recipe_id}
    ).first()
    if recipe_row is None:
        return False

    claimed = session.execute(
        text(
            "SELECT id FROM notification_outbox "
            "WHERE id = :id AND processed_at IS NULL FOR UPDATE SKIP LOCKED"
        ),
        {"id": outbox_id},
    ).first()
    if claimed is None:
        # 処理済み、または他（BackgroundTasks / スイープ）が処理中。
        return False

    if recipe_row.is_public:
        # フォロワー全員ぶんを 1 文でまとめて INSERT する。受信者は「今この時点」の
        # follows で決まる（notification.md §8）。`r.is_public` も条件に入れて二重に守る。
        session.execute(
            text(
                """
                INSERT INTO notifications (id, user_id, type, actor_id, recipe_id, created_at)
                SELECT gen_random_uuid(), f.follower_id, 'followee_new_recipe',
                       o.author_id, o.recipe_id, o.created_at
                FROM notification_outbox o
                JOIN recipes r ON r.id = o.recipe_id AND r.is_public
                JOIN follows f ON f.followee_id = o.author_id AND f.follower_id <> o.author_id
                WHERE o.id = :id
                ON CONFLICT (user_id, recipe_id) WHERE type = 'followee_new_recipe'
                DO NOTHING
                """
            ),
            {"id": outbox_id},
        )

    session.execute(
        text("UPDATE notification_outbox SET processed_at = clock_timestamp() WHERE id = :id"),
        {"id": outbox_id},
    )
    return True


def deliver_outbox_for_recipe(recipe_id: uuid.UUID) -> None:
    """`BackgroundTasks` から呼ぶ入口。そのレシピの配布予定を配る。

    リクエストのセッションはもう閉じているので、自分でセッションを開く。
    失敗しても例外は外へ投げない（レシピ投稿そのものは成功している。副次的な
    後始末はベストエフォート）。行は未処理のまま残り、スイープが後で配る。
    """
    try:
        with Session(engine) as session:
            outbox_id = session.execute(
                text(
                    "SELECT id FROM notification_outbox "
                    "WHERE recipe_id = :rid AND event = 'followee_new_recipe'"
                ),
                {"rid": recipe_id},
            ).scalar_one_or_none()
            if outbox_id is None:
                return
            deliver_one(session, outbox_id)
            session.commit()
    except Exception:
        logger.exception("新着レシピ通知の配布に失敗しました（スイープが再試行します）")
