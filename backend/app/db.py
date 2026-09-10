"""データベース接続の設定。

- SQLAlchemy（SQLModel が内部で使う）の「エンジン」を 1 つ作る。
  エンジン = 接続プールを持つ DB への窓口。
- リクエストごとに「セッション」を開いて使い、終わったら閉じる
  （FastAPI の依存性 `get_session` として提供する）。

Phase 0 では実際のテーブルはまだ無い。`check_db_connection()` は
scaffold の疎通確認（ヘルスチェックの readiness）に使う。
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Generator

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, create_engine

from app.config import settings

logger = logging.getLogger(__name__)

# SQL をログで見たいときは `RECIPI_SQL_ECHO=1` を環境変数に設定する
# （デフォルト off。on にすると全 SQL がログに出て、学習時に便利）。
_sql_echo = os.environ.get("RECIPI_SQL_ECHO", "").lower() in {"1", "true", "yes"}

engine = create_engine(
    settings.DATABASE_URL,
    echo=_sql_echo,
    pool_pre_ping=True,  # プール内の死んだ接続を使う前に検知して張り直す
    # DB が居ないときに長時間ブロックしないよう接続タイムアウトを短くする
    # （psycopg のパラメータ。テストやヘルスチェックがすぐ失敗判定できる）。
    connect_args={"connect_timeout": 3},
)


def get_session() -> Generator[Session]:
    """FastAPI の依存性。`Depends(get_session)` で 1 リクエスト 1 セッション。

    例外が発生したら rollback する。正常終了時にもここで commit するが、
    これは「呼び出し側が commit を書き忘れた場合の保険」に過ぎない。
    FastAPI は `Depends(yield)` の `yield` より後ろのコード（この commit も
    含む）を「レスポンスをクライアントに送信し終えた後」に実行するため、
    ここでの自動 commit だけに頼ると、クライアントが成功レスポンスを
    受け取った直後の別リクエストが、まだ確定していない古い状態を読んでしまう
    競合状態になりうる。**ルーター側は書き込みを終えたら `return` する前に
    必ず自分で `session.commit()` を呼ぶこと**（`app/api/auth.py` 冒頭参照）。
    """
    with Session(engine) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


# --- デッドロック / 直列化失敗のリトライ ------------------------------
#
# カウント列の増減は「関係する行をロックしてから ± する」ので、同じ相手に
# 同時操作が集中すると PostgreSQL が片方を中断することがある:
#
# - `40P01` deadlock_detected  … 2 つのトランザクションが互いのロックを待った
# - `40001` serialization_failure … 直列化できない同時実行を検知した
#
# どちらも「もう一度やれば普通は通る」種類の失敗なので、**サーバー側で**
# 数回やり直してクライアントには見せない（non-functional.md / follow.md §3）。
# ロールバックしてからやり直すのが重要で、中断されたトランザクションのまま
# 次の SQL を投げても「current transaction is aborted」で全部失敗する。

_RETRYABLE_SQLSTATES = frozenset({"40001", "40P01"})

# リトライ上限。3 回にした理由: 1 回目で失敗しても、待っていた相手は
# その時点でコミット済みなので 2 回目はほぼ通る。それでも駄目な状況
# （極端な競合）は、回数を増やすより 500 を返して調べたほうがよい（todo.md #10）。
MAX_RETRIES = 3


def _sqlstate_of(exc: DBAPIError) -> str | None:
    """DB ドライバの例外から SQLSTATE（5 文字のエラーコード）を取り出す。"""
    # psycopg 3 の例外は `sqlstate` 属性を持つ。ドライバを差し替えても
    # 落ちないよう getattr で取り、無ければ None にする。
    return getattr(exc.orig, "sqlstate", None)


def run_with_retry[T](session: Session, operation: Callable[[], T]) -> T:
    """`operation` を実行して commit する。競合で落ちたら数回やり直す。

    `operation` は**何度呼ばれてもよい**（＝ 現在の DB 状態を読み直して書く）
    ように書くこと。ロールバック後は前回の書き込みが無かったことになるため、
    Python 側で覚えた値を再利用すると食い違う。

    使い方（ルーター側）::

        run_with_retry(session, lambda: follow_service.follow(session, me, target_id))

    リトライ対象外の例外（バリデーションエラー等）はそのまま送出する。
    """
    last_error: DBAPIError | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = operation()
            session.commit()
            return result
        except DBAPIError as exc:
            if _sqlstate_of(exc) not in _RETRYABLE_SQLSTATES:
                raise
            # 中断されたトランザクションを畳んでから次の試行に入る。
            session.rollback()
            last_error = exc
            logger.warning(
                "retrying transaction after a concurrency failure",
                extra={"attempt": attempt, "sqlstate": _sqlstate_of(exc)},
            )
    # 上限まで試しても駄目だった。ここに来るのは異常事態なので、
    # 握りつぶさず最後の例外を投げ直す（500 になり、ログに残る）。
    assert last_error is not None
    raise last_error


def check_db_connection() -> bool:
    """DB に `SELECT 1` を投げて疎通できるか確認する。失敗しても例外は投げない。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001  疎通確認なので理由を問わず False にする
        return False
