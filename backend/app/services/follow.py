"""フォロー / フォロワーのドメインロジック（features/follow.md）。

ルーター（app/api/users.py）は HTTP の入出力だけを担い、トランザクション設計・
可視性・カーソルページングはここに集約する。

## 片方向フォロー ＋ 冪等

A が B をフォローする = `follows` に `(A → B)` を 1 行作るだけ。承認は要らない。
二重フォローしても 1 行のまま、未フォローの解除も成功（204）にする。
モバイルは通信が不安定で同じリクエストが 2 回届くことがあるため、
「何回押しても結果が同じ」であることが重要（processing-model.md §2「冪等」）。

## カウント列を正しく増減させる 3 つの工夫

`users.following_count` / `follower_count` は集計クエリの代わりに持つ
非正規化カラム（non-functional.md「カウント列キャッシュ」）。ズレないように:

1. **`ON CONFLICT DO NOTHING` の実行行数で分岐する。**
   「1 行入った」ときだけ +1 する。二重フォローで 0 行だったら何もしない。
   先に SELECT して存在確認 → 無ければ INSERT、と書くと、その隙間に別の
   リクエストが入り込んで両方が +1 してしまう（数え間違い）。

2. **更新前に対象行を `SELECT ... FOR UPDATE` でロックする。**
   同じ相手に同時にフォローが来ても、ロックで順番待ちになるので
   「両方が同じ値を読んで同じ値を書く」取りこぼしが起きない。

3. **複数行のロックは必ず id の昇順で取る。**
   A→B と B→A のフォローが同時に来たとき、片方が A→B の順、もう片方が
   B→A の順にロックすると互いに待ち合ってデッドロックになる。
   全員が同じ順番で取れば、先にロックできた方から順に進む。

それでも起きうる `deadlock` / `serialization_failure` は、ルーター側の
`run_with_retry()`（app/db.py）がサーバー内でやり直す。クライアントには見せない。

## このモジュールは commit しない

書き込み関数は `session.commit()` を呼ばない。`run_with_retry()` が
「実行 → コミット、駄目ならロールバックしてやり直し」をまとめて面倒みるため。
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, delete, select

from app.errors import not_found, validation_error
from app.models.follow import Follow
from app.models.user import User
from app.schemas.follow import UserProfileResponse, UserRow, UserRowListResponse
from app.services.notification import create_single_notification

# --- カーソル（(created_at, user_id) の複合） --------------------------
#
# 並び順のキーがフィード（recipes.created_at）や履歴（viewed_at）と違うので、
# エンコード関数もこのモジュール専用に持つ（取り違え防止。history.py と同じ方針）。

_CURSOR_SEP = "|"


def _encode_cursor(created_at: datetime, user_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{user_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_at_str, id_str = raw.split(_CURSOR_SEP, 1)
        return datetime.fromisoformat(created_at_str), uuid.UUID(id_str)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        # 壊れたカーソルは 500 ではなく 400 にする（recipe.py / history.py と同じ）。
        raise validation_error("ページングカーソルが不正です") from exc


# --- 共通の小さな部品 -------------------------------------------------


def _load_user_or_404(session: Session, user_id: uuid.UUID) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise not_found("ユーザーが見つかりません")
    return user


def _lock_users_in_id_order(session: Session, user_ids: list[uuid.UUID]) -> None:
    """カウント列を更新する前に、対象の `users` 行を id 昇順でロックする。

    ポイントが 2 つある。

    **① `ORDER BY id` で順番を固定する。**
    全員が同じ順番でロックを取れば、待ち合いによるデッドロックが起きない
    （モジュール冒頭のコメント 3）。

    **② `FOR UPDATE` ではなく `FOR NO KEY UPDATE` を使う。**
    `follows` への INSERT / DELETE は、外部キーの整合性を守るために
    PostgreSQL が参照先の `users` 行へ自動的に `FOR KEY SHARE` ロックを取る。
    `FOR KEY SHARE` は共有ロックなので、同じ相手を同時にフォローする N 人が
    全員それを持てる。その状態で全員が `FOR UPDATE`（＝ `FOR KEY SHARE` と
    衝突する）へ「昇格」しようとすると、**全員が他の全員の解放を待って
    デッドロック**になる（実際に 5 並列のテストで再現した）。

    `FOR NO KEY UPDATE` は「主キーは変えない更新をする」宣言で、
    `FOR KEY SHARE` とは衝突せず、同じ `FOR NO KEY UPDATE` どうしだけが
    順番待ちになる。カウント列は主キーではないのでこれで必要十分。
    """
    session.exec(
        select(User.id)
        .where(User.id.in_(user_ids))  # type: ignore[attr-defined]
        .order_by(User.id)  # type: ignore[arg-type]
        .with_for_update(key_share=True)
    ).all()


def _add_to_count(session: Session, user_id: uuid.UUID, column: str, delta: int) -> None:
    """`users` の 1 行のカウント列を、DB の中で原子的に ± する。

    Python 側で「読んで +1 して書く」のではなく `SET c = c + 1` の 1 文にする。
    読み書きの間に他のトランザクションが挟まっても、DB が現在値を元に計算する。
    """
    current = getattr(User, column)
    session.execute(
        update(User).where(User.id == user_id).values({column: current + delta})  # type: ignore[arg-type]
    )


def resolve_following_flags(
    session: Session,
    viewer: User,
    user_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """閲覧者がフォロー中のユーザー id を、まとめて 1 クエリで返す（N+1 回避）。

    一覧の行ごとに「この人をフォローしているか」を問い合わせると件数ぶん
    クエリが飛ぶので、表示する id を全部まとめて `IN` で 1 回引く
    （non-functional.md「N+1 クエリを避ける」）。
    """
    if not user_ids:
        return set()
    rows = session.exec(
        select(Follow.followee_id).where(
            Follow.follower_id == viewer.id,
            Follow.followee_id.in_(user_ids),  # type: ignore[attr-defined]
        )
    ).all()
    return set(rows)


# --- フォロー / フォロー解除 -----------------------------------------


def follow(session: Session, follower: User, followee_id: uuid.UUID) -> None:
    """`follower` が `followee_id` をフォローする（features/follow.md §5）。

    - 自分自身は 400、存在しないユーザーは 404
    - すでにフォロー済みなら何もしない（冪等）。カウントも通知も増やさない
    """
    if follower.id == followee_id:
        raise validation_error("自分自身をフォローすることはできません")
    _load_user_or_404(session, followee_id)

    # **ロックは INSERT より先に取る。** 逆順（INSERT → ロック）にすると、
    # INSERT が外部キーのために取る `FOR KEY SHARE` を持ったまま、より強い
    # ロックへ昇格することになり、同じ相手への同時フォローがデッドロックする
    # （`_lock_users_in_id_order` のコメント②）。先に取っておけば、
    # 各トランザクションは最初の 1 か所で順番待ちになるだけで済む。
    _lock_users_in_id_order(session, [follower.id, followee_id])

    # 「まだ無ければ 1 行作る」。すでにあれば何もしない（例外にはならない）。
    #
    # **実際に入ったかどうかは `RETURNING` の有無で判定する。** `rowcount` を
    # 見る書き方もあるが、ORM 経由の INSERT では -1（＝「不明」）が返ることが
    # あり、「入ったのに 0 と誤判定してカウントを増やし忘れる」事故になる。
    # `RETURNING` なら、行が入ったときだけ結果が 1 行返るので確実。
    inserted = session.execute(
        pg_insert(Follow)
        .values(follower_id=follower.id, followee_id=followee_id)
        .on_conflict_do_nothing(index_elements=["follower_id", "followee_id"])
        .returning(Follow.follower_id)  # type: ignore[call-overload]
    ).first()
    if inserted is None:
        # 二重フォロー。行は 1 本のままで、カウントも通知も動かさない。
        return

    _add_to_count(session, follower.id, "following_count", 1)
    _add_to_count(session, followee_id, "follower_count", 1)

    # フォロー成立を相手に知らせる。同一トランザクションなので
    # 「フォローは成立したのに通知が無い」状態にならない（notification.md §3）。
    create_single_notification(
        session,
        user_id=followee_id,
        type="followed",
        actor_id=follower.id,
    )

    # 一括 UPDATE でカウントを変えたので、メモリ上の User が古いままになる。
    # 同じリクエストの後続処理が古い値を読まないよう、次のアクセスで
    # 読み直させる（DB から取り直すだけで、書き込みは発生しない）。
    session.expire(follower)


def unfollow(session: Session, follower: User, followee_id: uuid.UUID) -> None:
    """フォローを解除する。未フォローでも成功扱い（冪等・204）。

    解除は「存在しないユーザーでも 204」にする（follow.md §5）。
    フォローしていない = 何も起きない、という結果は同じだからで、
    ここで 404 を返すと ID の存在有無が漏れる。
    """
    # フォローと同じ理由で、ロックは DELETE より先に取る（DELETE も外部キーの
    # ために参照先へ `FOR KEY SHARE` を取るため、後からの昇格はデッドロックする）。
    _lock_users_in_id_order(session, [follower.id, followee_id])

    # フォロー時と同じ理由で、消えたかどうかは `RETURNING` で判定する。
    # `synchronize_session=False` は「ORM のメモリ上のオブジェクトと
    # 同期しようとしない」指定。ここでは Follow をオブジェクトとして
    # 読んでいないので同期は不要で、余計なクエリを避けられる。
    deleted = session.execute(
        delete(Follow)
        .where(
            Follow.follower_id == follower.id,  # type: ignore[arg-type]
            Follow.followee_id == followee_id,  # type: ignore[arg-type]
        )
        .returning(Follow.follower_id),  # type: ignore[call-overload]
        execution_options={"synchronize_session": False},
    ).first()
    if deleted is None:
        # もともとフォローしていなかった。カウントは動かさない。
        return

    _add_to_count(session, follower.id, "following_count", -1)
    _add_to_count(session, followee_id, "follower_count", -1)

    # 通知は「起きた出来事の履歴」なので、解除しても既存の `followed` 通知は
    # 消さない（notification.md §3）。
    session.expire(follower)


# --- 一覧 -------------------------------------------------------------


def _list_users(  # type: ignore[no-untyped-def]
    session: Session,
    viewer: User,
    *,
    stmt,
    cursor: str | None,
    limit: int,
) -> UserRowListResponse:
    """`follows` と `users` を結合した一覧の共通処理（並び・ページング・フラグ解決）。

    並びは `follows.created_at DESC, users.id DESC`（同時刻は id で継ぐ）。
    「新しくフォローした人 / 新しくフォローしてくれた人」が上に来る。
    """
    if cursor is not None:
        c_created, c_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Follow.created_at < c_created) | ((Follow.created_at == c_created) & (User.id < c_id))
        )

    stmt = stmt.order_by(Follow.created_at.desc(), User.id.desc()).limit(limit + 1)  # type: ignore[attr-defined]
    rows = list(session.exec(stmt).all())

    # limit + 1 件取り、余分に取れたら「次ページあり」。余分の 1 件は返さない。
    has_more = len(rows) > limit
    page = rows[:limit]
    users = [user for user, _ in page]
    following_ids = resolve_following_flags(session, viewer, [u.id for u in users])

    items = [
        UserRow(
            id=user.id,
            display_name=user.display_name,
            is_following=user.id in following_ids,
        )
        for user in users
    ]
    next_cursor = None
    if has_more and page:
        last_user, last_created = page[-1]
        next_cursor = _encode_cursor(last_created, last_user.id)
    return UserRowListResponse(items=items, next_cursor=next_cursor)


def list_following(
    session: Session,
    viewer: User,
    target_id: uuid.UUID,
    *,
    cursor: str | None,
    limit: int,
) -> UserRowListResponse:
    """`target_id` がフォローしているユーザー一覧（follow.md §5）。"""
    _load_user_or_404(session, target_id)
    stmt = (
        select(User, Follow.created_at)
        .join(Follow, Follow.followee_id == User.id)  # type: ignore[arg-type]
        .where(Follow.follower_id == target_id)
    )
    return _list_users(session, viewer, stmt=stmt, cursor=cursor, limit=limit)


def list_followers(
    session: Session,
    viewer: User,
    target_id: uuid.UUID,
    *,
    cursor: str | None,
    limit: int,
) -> UserRowListResponse:
    """`target_id` をフォローしているユーザー一覧（follow.md §5）。

    `list_following` と結合の向きだけが逆（`followee_id` で引き、`follower_id`
    のユーザーを並べる）。各行の `isFollowing` は**閲覧者から見た状態**なので、
    自分のフォロワー一覧では「フォローバック済みか」を表す。
    """
    _load_user_or_404(session, target_id)
    stmt = (
        select(User, Follow.created_at)
        .join(Follow, Follow.follower_id == User.id)  # type: ignore[arg-type]
        .where(Follow.followee_id == target_id)
    )
    return _list_users(session, viewer, stmt=stmt, cursor=cursor, limit=limit)


# --- プロフィール（最小版） -------------------------------------------


def get_user_profile(session: Session, viewer: User, target_id: uuid.UUID) -> UserProfileResponse:
    """`GET /users/{id}` の最小版（features/profile.md §5）。

    アバター・メール・SNS リンク・公開トグルはプロフィール拡張の Issue で足す。
    ここではフォロー機能の画面（ユーザープロフィール / フォロー・フォロワー画面）に
    必要な「表示名 ＋ フォロー数 / フォロワー数 ＋ 自分がフォロー中か」だけを返す。
    """
    target = _load_user_or_404(session, target_id)
    is_following: bool | None
    if target.id == viewer.id:
        # 自分自身にフォローの概念は無いので null（profile.md §5 の本人取得例）。
        is_following = None
    else:
        is_following = bool(resolve_following_flags(session, viewer, [target.id]))
    return UserProfileResponse(
        id=target.id,
        display_name=target.display_name,
        following_count=target.following_count,
        follower_count=target.follower_count,
        is_following=is_following,
    )
