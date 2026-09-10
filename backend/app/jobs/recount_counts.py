"""カウント列補正ジョブ（processing-model.md §8「カウント列補正ジョブ」）。

## なぜ要るのか — 「多層防御」の 2 層目

`users.following_count` / `follower_count` は、`follows` の INSERT / DELETE と
**同一トランザクション**で ± されるので、通常はこれだけでズレない
（第 1 層。app/services/follow.py）。

それでも、バグ・異常終了・移行作業・直接 SQL での修正といった理由で
実数と食い違うことはある。そのとき「一覧に出るのに数字が合わない」状態が
放置されると、原因を追うのが難しくなる。そこで**実数から数え直して上書きする**
コマンドを用意しておく（第 2 層）。これが「多層防御」の考え方。

補正ジョブがあるからといって、書き込み時の増減を省いてよいわけではない。
第 1 層が正で、これは残余のズレを直す保険（non-functional.md）。

## 冪等

やることは「実数に合わせる」だけなので、何度流しても結果は同じ。
そのため多重起動しても壊れない（それでも運用では 1 本に絞る。Phase 10）。

## 使い方

    python -m app.jobs.recount_counts

お気に入り（`recipes.favorite_count`）と感想（`recipes.comment_count`）の
補正は、それぞれの機能の Issue でこのファイルに追加していく。
"""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import CursorResult, func, select, update
from sqlmodel import Session

from app.db import engine
from app.logging_config import configure_logging
from app.models.follow import Follow
from app.models.user import User

logger = logging.getLogger(__name__)


def recount_follow_counts(session: Session) -> int:
    """`follows` の実数から `users` の 2 つのカウント列を数え直す。

    ズレていた行数を返す（呼び出し側で `session.commit()` すること。テストから
    件数を検証しやすいように、コミットはこの関数の外に出している）。

    実装のポイント: ユーザーを 1 人ずつループして `COUNT(*)` すると、
    ユーザー数ぶんクエリが飛ぶ。相関サブクエリを使った 1 本の UPDATE に
    まとめると、DB の中だけで完結する。
    """
    # そのユーザーがフォローしている人数 = follows.follower_id = users.id の行数
    following_expr = (
        select(func.count())
        .select_from(Follow)
        .where(Follow.follower_id == User.id)  # type: ignore[arg-type]
        .scalar_subquery()
    )
    # そのユーザーをフォローしている人数 = follows.followee_id = users.id の行数
    follower_expr = (
        select(func.count())
        .select_from(Follow)
        .where(Follow.followee_id == User.id)  # type: ignore[arg-type]
        .scalar_subquery()
    )

    # WHERE で「今の値と実数が違う行」だけに絞る。全行を無条件に UPDATE すると、
    # 変わっていない行まで書き換えて WAL（更新ログ）が無駄に膨らむ。
    result = cast(
        "CursorResult[Any]",
        session.execute(
            update(User)
            .where(
                (User.following_count != following_expr)  # type: ignore[arg-type]
                | (User.follower_count != follower_expr)
            )
            .values(following_count=following_expr, follower_count=follower_expr)
        ),
    )
    return result.rowcount or 0


def main() -> None:
    configure_logging()
    with Session(engine) as session:
        fixed = recount_follow_counts(session)
        session.commit()
    logger.info("recount finished", extra={"users_fixed": fixed})


if __name__ == "__main__":
    main()
