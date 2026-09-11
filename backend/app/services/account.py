"""アカウント削除（`DELETE /users/me`）。

features/profile.md §5・data-model.md「アカウント削除時の CASCADE」。

`DELETE FROM users WHERE id = :me` の 1 文で、外部キーの ON DELETE CASCADE により
本人のレシピ・フォロー（両方向）・お気に入り・感想・通知・閲覧履歴・リフレッシュ
トークン・アップロード管理行・通知 outbox がまとめて消える。ただし DB が勝手に
やってくれないことが 2 つあり、それを**同じトランザクションの中で、DELETE より前に**行う。

## 1. 画像キーを CASCADE より前に集める

画像そのものはオブジェクトストレージにあり、DB の CASCADE では消えない。消えるのは
「どのキーの画像か」を覚えている行の方で、行が消えた後ではキーを取り出せない。
なので、DELETE の前にキーを集めて削除キュー（`pending_storage_deletions`）に積む。
実際のストレージ削除は定期ジョブが行う（processing-model.md §6・§9）。

## 2. 生き残る他人のカウント列を減らす

`users.follower_count` などは「数えなくて済むように持っているキャッシュ」。本人の
フォロー行が CASCADE で消えても、相手の `follower_count` は DB が勝手には減らさない。
補正ジョブ（recount_counts）は念のための保険で、それに任せると次に動くまで数字が
ずれたままになる。なので削除と同じトランザクションで減算する（non-functional.md
「カウント列キャッシュのトランザクション方針」・todo.md #10）。

## ロックの順番

1. 本人の users 行を `FOR UPDATE`。本人に関係する行を新しく作る処理（フォロー・
   お気に入り・感想・アップロード・レシピ作成）は、外部キーの確認で本人行に
   `FOR KEY SHARE` を取るので、ここで止まる。以降に集める集合が途中で増えない
2. 関係者の users 行 → 関係するレシピ行 → 本人のアップロード行（それぞれ id 順）

逆向きの順番を取る処理（お気に入り・感想の投稿は recipes → users）とはデッドロック
しうるが、PostgreSQL が片方を中断し、`run_with_retry()` がやり直す（データは壊れない）。

このモジュールはコミットしない（ルーターが `run_with_retry` の中でコミットする）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.exc import InvalidRequestError
from sqlmodel import Session

from app.config import settings
from app.errors import unauthorized
from app.models.user import User
from app.services.image import enqueue_object_deletion

DELETION_REASON = "account_deleted"


def collect_account_keys(session: Session, user_id: uuid.UUID) -> list[tuple[str, datetime | None]]:
    """アカウント削除で参照が消える画像キーを `(キー, delete_after)` で返す（重複なし）。

    **CASCADE より前に呼ぶこと**（行が消えた後では何も返らない）。ORM のオブジェクト
    ではなく列の値だけを SQL で読むので、セッションに残った古い値を見ない。

    - 自分のレシピのサムネイル・手順画像
    - 自分のレシピに付いた感想（他人が書いたものも）の画像
    - 自分が書いた感想（他人のレシピへのものも）の画像
    - アバター
    - 本人所有で未使用（pending / stored）のアップロード。pending（PUT がまだ
      終わっていないかもしれない）は、期限にさらに同じ長さの猶予を足した時刻まで
      実削除を遅らせる（delete_after）
    """
    rows = session.execute(
        text(
            """
            SELECT thumbnail_key AS key FROM recipes WHERE user_id = :me
            UNION ALL
            SELECT s.image_key FROM steps s JOIN recipes r ON r.id = s.recipe_id
             WHERE r.user_id = :me
            UNION ALL
            SELECT c.image_key FROM recipe_comments c JOIN recipes r ON r.id = c.recipe_id
             WHERE r.user_id = :me
            UNION ALL
            SELECT image_key FROM recipe_comments WHERE user_id = :me
            UNION ALL
            SELECT avatar_key FROM users WHERE id = :me
            """
        ),
        {"me": user_id},
    ).all()

    keys: dict[str, datetime | None] = {}
    for (key,) in rows:
        if key:
            keys[key] = None

    grace = timedelta(seconds=settings.UPLOAD_PENDING_TTL_SECONDS)
    uploads = session.execute(
        text(
            "SELECT key, status, expires_at FROM uploads "
            "WHERE user_id = :me AND status IN ('pending', 'stored')"
        ),
        {"me": user_id},
    ).all()
    for key, status, expires_at in uploads:
        if key in keys:
            continue
        keys[key] = expires_at + grace if status == "pending" else None
    return list(keys.items())


def _lock_rows(session: Session, table: str, ids: list[uuid.UUID], mode: str) -> None:
    """指定の行を id 順にロックする（全員が同じ順で取れば待ち合いにならない）。"""
    if not ids:
        return
    session.execute(
        text(f"SELECT id FROM {table} WHERE id = ANY(:ids) ORDER BY id FOR {mode}"),
        {"ids": ids},
    )


def _ids(session: Session, sql: str, me: uuid.UUID) -> list[uuid.UUID]:
    return [row[0] for row in session.execute(text(sql), {"me": me}).all()]


def delete_account(session: Session, user: User) -> None:
    """本人のアカウントを削除する（コミットはしない）。"""
    me = user.id

    # --- 1. 本人行をロックして読み直す -------------------------------------
    # `get_current_user` が読み込んだ User は古いかもしれない（アバターを同時に
    # 変えていた等）。ロックと同時に DB の最新値で上書きする。
    try:
        session.refresh(user, with_for_update=True)
    except InvalidRequestError:
        # 同時に 2 回退会した 2 件目。1 件目がもう消している。
        raise unauthorized("ユーザーが見つかりません") from None

    # 既に発行したアクセストークンを無効にする（DB の中で +1。読んで書くのではない）。
    session.execute(
        text("UPDATE users SET token_version = token_version + 1 WHERE id = :me"), {"me": me}
    )

    # --- 2. 影響する行を集める（本人行をロック済みなので、もう増えない） ----------
    related_users = _ids(
        session,
        """
        SELECT followee_id FROM follows WHERE follower_id = :me
        UNION
        SELECT follower_id FROM follows WHERE followee_id = :me
        """,
        me,
    )
    related_recipes = _ids(
        session,
        """
        SELECT id FROM recipes WHERE user_id = :me
        UNION
        SELECT f.recipe_id FROM favorites f JOIN recipes r ON r.id = f.recipe_id
         WHERE f.user_id = :me AND r.user_id <> :me
        UNION
        SELECT c.recipe_id FROM recipe_comments c JOIN recipes r ON r.id = c.recipe_id
         WHERE c.user_id = :me AND r.user_id <> :me
        """,
        me,
    )
    my_uploads = _ids(
        session,
        "SELECT id FROM uploads WHERE user_id = :me AND status IN ('pending', 'stored')",
        me,
    )

    # --- 3. 関係者 → レシピ → アップロードの順にロック -------------------------
    # 他人が本人のレシピにお気に入り・感想を付ける処理は、レシピ行を先にロックする
    # ので、ここで止まる。アップロード行は GC（SKIP LOCKED で飛ばす）や本人の別
    # リクエストの画像消費と取り合わないように押さえる。
    _lock_rows(session, "users", related_users, "NO KEY UPDATE")
    _lock_rows(session, "recipes", related_recipes, "NO KEY UPDATE")
    _lock_rows(session, "uploads", my_uploads, "UPDATE")

    # --- 4. CASCADE より前に画像キーを削除キューへ ----------------------------
    for key, delete_after in collect_account_keys(session, me):
        enqueue_object_deletion(session, key, DELETION_REASON, delete_after=delete_after)

    # --- 5. 生き残る他人のカウント列を減らす（DELETE の前。行が消えると数えられない） --
    _subtract_counts(session, me)

    # --- 6. 本人を消す（CASCADE で関連行も消える） ------------------------------
    # ORM の `session.delete(user)` だと、関係のある子を ORM が個別に扱おうとする
    # ことがあるので、SQL 1 文で DB の CASCADE に任せる。
    session.execute(text("DELETE FROM users WHERE id = :me"), {"me": me})
    session.expunge(user)


def _subtract_counts(session: Session, me: uuid.UUID) -> None:
    """消えるフォロー・お気に入り・感想のぶん、生き残る相手のカウント列を減らす。

    どれも「消える行を相手ごとに数えて、その数だけ引く」を 1 文でまとめて行う。
    相手の行は手順 3 でロック済みなので、引いている間に他の処理が割り込まない。
    自分自身の行・自分のレシピは一緒に消えるので対象外。
    """
    # 本人がフォローしていた相手の follower_count を −1。
    session.execute(
        text(
            """
            UPDATE users u SET follower_count = u.follower_count - 1
              FROM follows f
             WHERE f.follower_id = :me AND u.id = f.followee_id
            """
        ),
        {"me": me},
    )
    # 本人をフォローしていた相手の following_count を −1。
    session.execute(
        text(
            """
            UPDATE users u SET following_count = u.following_count - 1
              FROM follows f
             WHERE f.followee_id = :me AND u.id = f.follower_id
            """
        ),
        {"me": me},
    )
    # 本人がお気に入りしていた他人のレシピの favorite_count を −1（1 人 1 レシピ 1 行）。
    session.execute(
        text(
            """
            UPDATE recipes r SET favorite_count = r.favorite_count - 1
              FROM favorites f
             WHERE f.user_id = :me AND r.id = f.recipe_id AND r.user_id <> :me
            """
        ),
        {"me": me},
    )
    # 本人が感想を書いた他人のレシピの comment_count を、書いた件数ぶん減らす。
    session.execute(
        text(
            """
            UPDATE recipes r SET comment_count = r.comment_count - c.n
              FROM (SELECT recipe_id, count(*) AS n FROM recipe_comments
                     WHERE user_id = :me GROUP BY recipe_id) c
             WHERE r.id = c.recipe_id AND r.user_id <> :me
            """
        ),
        {"me": me},
    )
