"""データベース接続の設定。

- SQLAlchemy（SQLModel が内部で使う）の「エンジン」を 1 つ作る。
  エンジン = 接続プールを持つ DB への窓口。
- リクエストごとに「セッション」を開いて使い、終わったら閉じる
  （FastAPI の依存性 `get_session` として提供する）。

Phase 0 では実際のテーブルはまだ無い。`check_db_connection()` は
scaffold の疎通確認（ヘルスチェックの readiness）に使う。
"""

from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import text
from sqlmodel import Session, create_engine

from app.config import settings

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


def check_db_connection() -> bool:
    """DB に `SELECT 1` を投げて疎通できるか確認する。失敗しても例外は投げない。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001  疎通確認なので理由を問わず False にする
        return False
