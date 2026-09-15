"""性能テスト（k6）のデータを消す後始末スクリプト（Issue #145）。

対象は ``perfuser_…@example.com`` のユーザーとその持ち物。消し方・安全装置・
残数 0 の確認は E2E の後始末（``cleanup_e2e.cleanup``）をそのまま使う
（ローカル以外への接続・対象外の行に触れる場合は何も消さない）。

実行例（``backend`` で実行する）::

    cd backend
    APP_ENV=development python -m scripts.cleanup_perf --dry-run
    APP_ENV=development python -m scripts.cleanup_perf --yes
"""

from __future__ import annotations

import argparse
import sys
from datetime import timedelta

from sqlmodel import Session

from scripts.cleanup_e2e import CleanupError, assert_cleanup_target, cleanup
from scripts.seed_perf import PERF_EMAIL_PATTERN


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="性能テストのデータ（perfuser_）を削除する")
    parser.add_argument("--dry-run", action="store_true", help="件数を表示するだけで消さない")
    parser.add_argument("--yes", action="store_true", help="確認なしで実行する")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """コマンドの入口。成功で 0、安全装置・後始末の失敗で 1、引数の誤りで 2 を返す。"""
    args = _parse_args(argv)
    if not args.dry_run and not args.yes:
        print(
            "削除するには --yes を付けてください（件数だけ見るなら --dry-run）。", file=sys.stderr
        )
        return 2

    # 設定と DB は、引数を確かめた後に読み込む（--help だけで接続しないように）。
    from app.config import settings
    from app.db import engine

    try:
        assert_cleanup_target(settings.APP_ENV, settings.DATABASE_URL)
    except CleanupError as exc:
        print(exc, file=sys.stderr)
        return 1

    grace = timedelta(seconds=settings.UPLOAD_PENDING_TTL_SECONDS)
    with Session(engine) as session:
        try:
            report = cleanup(session, PERF_EMAIL_PATTERN, dry_run=args.dry_run, pending_grace=grace)
        except CleanupError as exc:
            print(exc, file=sys.stderr)
            return 1

    print(
        f"ユーザー {len(report.users)} 件 / レシピ {len(report.recipes)} 件 / "
        f"巻き添え {report.collateral}"
    )
    if args.dry_run:
        print("dry-run のため何も消していません。")
        return 1 if report.has_collateral else 0
    print("後始末が完了しました（残数 0）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
