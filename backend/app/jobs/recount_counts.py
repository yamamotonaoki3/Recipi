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
そのため多重起動しても、また通常のフォロー / 解除処理と並行しても壊れない。
並行して users 行が更新された場合は、REPEATABLE READ が古いスナップショット
のまま上書きすることを防ぎ、serialization failure になった補正をロールバック
して、コミット後の実数を読み直してやり直す（それでも運用では 1 本に絞る。
Phase 10）。

## 使い方

    python -m app.jobs.recount_counts

数え直す対象（4 列。Issue #72 でそろったことをテストで確認）:
- `users.following_count` / `follower_count` ← `follows`（Issue #66）
- `recipes.favorite_count` ← `favorites`（Issue #68）
- `recipes.comment_count` ← `recipe_comments`（Issue #69）
"""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import CursorResult, func, select, update
from sqlmodel import Session

from app.db import engine, run_with_retry
from app.logging_config import configure_logging
from app.models.favorite import Favorite
from app.models.follow import Follow
from app.models.recipe import Recipe
from app.models.recipe_comment import RecipeComment
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


def recount_favorite_counts(session: Session) -> int:
    """`favorites` の実数から `recipes.favorite_count` を数え直す。

    ズレていた行数を返す（commit は呼び出し側）。作りは `recount_follow_counts` と
    同じで、相関サブクエリ 1 本の UPDATE にまとめ、今の値と実数が違う行だけを書く。
    """
    favorite_expr = (
        select(func.count())
        .select_from(Favorite)
        .where(Favorite.recipe_id == Recipe.id)  # type: ignore[arg-type]
        .scalar_subquery()
    )
    result = cast(
        "CursorResult[Any]",
        session.execute(
            update(Recipe)
            .where(Recipe.favorite_count != favorite_expr)  # type: ignore[arg-type]
            .values(favorite_count=favorite_expr)
        ),
    )
    return result.rowcount or 0


def recount_comment_counts(session: Session) -> int:
    """`recipe_comments` の実数から `recipes.comment_count` を数え直す（作りは他と同じ）。"""
    comment_expr = (
        select(func.count())
        .select_from(RecipeComment)
        .where(RecipeComment.recipe_id == Recipe.id)  # type: ignore[arg-type]
        .scalar_subquery()
    )
    result = cast(
        "CursorResult[Any]",
        session.execute(
            update(Recipe)
            .where(Recipe.comment_count != comment_expr)  # type: ignore[arg-type]
            .values(comment_count=comment_expr)
        ),
    )
    return result.rowcount or 0


def _recount_all(session: Session) -> tuple[int, int, int]:
    """補正する列をすべて数え直す（1 つのトランザクションの中で呼ぶ）。

    戻り値は (users を直した行数, favorite_count を直した行数, comment_count を直した行数)。
    """
    return (
        recount_follow_counts(session),
        recount_favorite_counts(session),
        recount_comment_counts(session),
    )


def main() -> None:
    configure_logging()
    # 補正は「follows の実数を読む」と「users のカウントを書き換える」を
    # 1 つのトランザクションで行う。READ COMMITTED のままだと、別のフォロー
    # 処理が users 行を更新している間に UPDATE がロック待ちになったとき、
    # 行だけ新しい版に再評価されても、相関 COUNT(*) は待つ前の古いスナップ
    # ショットのままになり、正しく増えたカウントを古い実数で上書きしうる。
    # REPEATABLE READ なら、スナップショット取得後に更新された行を変更しようと
    # した時点で serialization failure になり、run_with_retry が rollback して
    # 新しいトランザクションで実数を読み直すので、この上書きを防げる。
    #
    # Session に 1 回だけ分離レベルを設定するのではなく、engine に execution
    # option を付ける。こうすると retry で接続を借り直す場合も毎回
    # REPEATABLE READ が適用される。
    recount_engine = engine.execution_options(isolation_level="REPEATABLE READ")
    # フォロー数とお気に入り数を同じトランザクション（＝同じスナップショット）で直す。
    # お気に入りの登録と競合したときも、フォローと同じ理由で上書きを防げる
    # （`recipes` 行のロックを待った UPDATE が serialization failure → やり直し）。
    with Session(recount_engine) as session:
        users_fixed, favorites_fixed, comments_fixed = run_with_retry(
            session, lambda: _recount_all(session)
        )
    logger.info(
        "recount finished",
        extra={
            "users_fixed": users_fixed,
            "favorites_fixed": favorites_fixed,
            "comments_fixed": comments_fixed,
        },
    )


if __name__ == "__main__":
    main()
