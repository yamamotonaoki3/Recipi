"""E2E テストが作ったデータを物理削除する後始末スクリプト（Issue #135）。

対象は ``e2euser_…@example.com`` のユーザーと、その持ち物（レシピ・材料・手順・
フォロー・お気に入り・感想・通知・閲覧履歴・トークン・アップロード）。

実行例（リポジトリルートの ``.env.<APP_ENV>`` を読む。``backend`` で実行する）::

    cd backend
    APP_ENV=development python -m scripts.cleanup_e2e --run-id 1726300000000-123 --dry-run
    APP_ENV=development python -m scripts.cleanup_e2e --run-id 1726300000000-123 --yes
    E2E_CLEANUP_ALLOW_ALL=1 APP_ENV=development python -m scripts.cleanup_e2e --all --yes

## アプリの退会と何が違うか

アプリの退会（``services/account.py``）は ``users`` 行とレシピを残す論理削除で、
残ったレシピはフィードや検索に出続ける。テストデータは「識別子だけを条件に一括で
消し、残数 0 を確かめる」必要がある（グローバル CLAUDE.md のテストデータ規約・
testing.md §4）ので、ここでは ``users`` を DELETE し、外部キーの CASCADE で持ち物を
まとめて消す。

## 安全装置（1 つでも満たさなければ何もしない）

1. ``APP_ENV`` が development / test で、接続先のホストがローカル（localhost /
   127.0.0.1 / compose のサービス名 postgres）であること
2. 対象を ``--run-id``（1 回の実行分）か ``--all``（``E2E_CLEANUP_ALLOW_ALL=1``
   のときだけ）で明示すること。``--dry-run`` 以外は ``--yes`` も要る
3. **E2E 以外の行に 1 件でも触れるなら何も消さない**（巻き添えの確認）。たとえば
   E2E のレシピに普通のユーザーが感想を書いていたら、その感想まで消えてしまうし、
   E2E ユーザーが普通のユーザーをフォローしていたら相手のフォロワー数がずれる

## ロックの順番

``users`` → ``recipes`` の順に ``FOR UPDATE`` を取る。対象ユーザーや対象レシピを
参照する行を新しく作る処理（レシピ作成・感想・お気に入り・フォロー・アップロード）は、
外部キーの確認で親の行に ``FOR KEY SHARE`` を取るので、ここで待たされる。
これで「確かめた後に行が増える」ことがない（``services/account.py`` と同じ考え方）。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlmodel import Session

from app.services.image import enqueue_object_deletion

DELETION_REASON = "e2e_cleanup"
ALLOWED_APP_ENVS = frozenset({"development", "test"})
ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "postgres"})
# run-id は LIKE のパターンに埋め込むので、特殊文字（_ %）を含まない文字だけにする。
RUN_ID_PATTERN = re.compile(r"^[0-9a-z-]+$")
ALLOW_ALL_ENV = "E2E_CLEANUP_ALLOW_ALL"

# 配列を ANY(...) に渡すときの書き方。空の配列でも型が決まるように明示的にキャストする。
_U = "ANY(CAST(:u AS uuid[]))"
_R = "ANY(CAST(:r AS uuid[]))"

# 巻き添えの確認。どれも「E2E 以外の行のうち、消える / 数字がずれるもの」の件数。
COLLATERAL_CHECKS: dict[str, str] = {
    # 片方だけが E2E ユーザーのフォロー（相手のフォロー数 / フォロワー数がずれる）。
    "follows": f"SELECT count(*) FROM follows WHERE (follower_id = {_U}) <> (followee_id = {_U})",
    # E2E のレシピに、E2E 以外のユーザーが付けた行。
    "favorites_on_e2e_recipes": (
        f"SELECT count(*) FROM favorites WHERE recipe_id = {_R} AND NOT user_id = {_U}"
    ),
    "comments_on_e2e_recipes": (
        f"SELECT count(*) FROM recipe_comments WHERE recipe_id = {_R} AND NOT user_id = {_U}"
    ),
    "views_on_e2e_recipes": (
        f"SELECT count(*) FROM recipe_views WHERE recipe_id = {_R} AND NOT user_id = {_U}"
    ),
    # E2E ユーザーが、E2E 以外のレシピに付けた行（相手レシピのカウント列がずれる）。
    "favorites_on_other_recipes": (
        f"SELECT count(*) FROM favorites WHERE user_id = {_U} AND NOT recipe_id = {_R}"
    ),
    "comments_on_other_recipes": (
        f"SELECT count(*) FROM recipe_comments WHERE user_id = {_U} AND NOT recipe_id = {_R}"
    ),
    # E2E 以外のユーザーに届いた、E2E ユーザーやレシピ・感想に関する通知。
    "notifications_to_others": f"""
        SELECT count(*) FROM notifications n
         WHERE NOT n.user_id = {_U}
           AND (n.actor_id = {_U} OR n.recipe_id = {_R}
                OR n.comment_id IN (SELECT id FROM recipe_comments
                                     WHERE user_id = {_U} OR recipe_id = {_R}))
    """,
    # E2E 以外のレシピの材料が、E2E のレシピを「リンク」している行。リンク先が消えると
    # `ref_recipe_id` が SET NULL で書き換わる（models/ingredient.py）。
    "ingredient_links_from_other_recipes": (
        f"SELECT count(*) FROM ingredients WHERE ref_recipe_id = {_R} AND NOT recipe_id = {_R}"
    ),
    # まだ配っていない新着通知（配布の途中で E2E 以外に届く途中かもしれない）。
    "outbox_unprocessed": (
        "SELECT count(*) FROM notification_outbox "
        f"WHERE (author_id = {_U} OR recipe_id = {_R}) AND processed_at IS NULL"
    ),
}

# 後始末の後に 0 件であるべきもの（対象ユーザー ID・対象レシピ ID を参照する全テーブル）。
RESIDUAL_CHECKS: dict[str, str] = {
    "recipes": f"SELECT count(*) FROM recipes WHERE user_id = {_U} OR id = {_R}",
    "ingredient_groups": f"SELECT count(*) FROM ingredient_groups WHERE recipe_id = {_R}",
    "ingredients": f"SELECT count(*) FROM ingredients WHERE recipe_id = {_R}",
    "steps": f"SELECT count(*) FROM steps WHERE recipe_id = {_R}",
    "recipe_comments": (
        f"SELECT count(*) FROM recipe_comments WHERE user_id = {_U} OR recipe_id = {_R}"
    ),
    "favorites": f"SELECT count(*) FROM favorites WHERE user_id = {_U} OR recipe_id = {_R}",
    "follows": f"SELECT count(*) FROM follows WHERE follower_id = {_U} OR followee_id = {_U}",
    "recipe_views": f"SELECT count(*) FROM recipe_views WHERE user_id = {_U} OR recipe_id = {_R}",
    "notifications": (
        "SELECT count(*) FROM notifications "
        f"WHERE user_id = {_U} OR actor_id = {_U} OR recipe_id = {_R}"
    ),
    "notification_outbox": (
        f"SELECT count(*) FROM notification_outbox WHERE author_id = {_U} OR recipe_id = {_R}"
    ),
    "uploads": f"SELECT count(*) FROM uploads WHERE user_id = {_U}",
    "refresh_tokens": f"SELECT count(*) FROM refresh_tokens WHERE user_id = {_U}",
}

# 対象ユーザーの持ち物が参照している画像キー。
_OWNED_KEYS_SQL = f"""
    SELECT avatar_key FROM users WHERE id = {_U}
    UNION SELECT thumbnail_key FROM recipes WHERE user_id = {_U}
    UNION SELECT s.image_key FROM steps s JOIN recipes r ON r.id = s.recipe_id
           WHERE r.user_id = {_U}
    UNION SELECT image_key FROM recipe_comments WHERE user_id = {_U}
"""

# 同じキーを、対象外の行が参照しているか（参照されていたら消してはいけない）。
_SHARED_KEY_SQL = f"""
    SELECT EXISTS (
        SELECT 1 FROM users WHERE avatar_key = :k AND NOT id = {_U}
        UNION ALL SELECT 1 FROM recipes WHERE thumbnail_key = :k AND NOT user_id = {_U}
        UNION ALL SELECT 1 FROM steps s JOIN recipes r ON r.id = s.recipe_id
                   WHERE s.image_key = :k AND NOT r.user_id = {_U}
        UNION ALL SELECT 1 FROM recipe_comments WHERE image_key = :k AND NOT user_id = {_U}
        UNION ALL SELECT 1 FROM uploads WHERE key = :k AND NOT user_id = {_U}
    )
"""


class CleanupError(RuntimeError):
    """安全装置に引っかかった / 後始末が完了しなかった。"""


@dataclass
class CleanupReport:
    """1 回の後始末の結果（dry-run でも同じ形で返す）。"""

    users: list[uuid.UUID]
    recipes: list[uuid.UUID]
    collateral: dict[str, int]
    image_keys: list[tuple[str, datetime | None]]
    shared_keys: list[str] = field(default_factory=list)
    # パスワード再設定の試行記録（users に紐付かずメールで記録されるので CASCADE で消えない）。
    reset_attempts: int = 0
    deleted: bool = False

    @property
    def has_collateral(self) -> bool:
        return any(self.collateral.values())


def assert_cleanup_target(app_env: str, database_url: str) -> None:
    """ローカルの開発 / テスト DB 以外への実行を拒否する。"""
    host = make_url(database_url).host
    if app_env not in ALLOWED_APP_ENVS or host not in ALLOWED_HOSTS:
        raise CleanupError(
            "E2E の後始末は APP_ENV=development / test かつ接続先がローカル"
            f"（{', '.join(sorted(ALLOWED_HOSTS))}）のときだけ実行できます"
            f"（APP_ENV={app_env}, host={host}）。"
        )


def email_pattern(run_id: str | None, *, all_users: bool) -> str:
    """対象ユーザーのメールに合う LIKE パターンを返す（`_` は 1 文字の意味なのでエスケープ）。"""
    if (run_id is None) == (not all_users):
        # 両方とも無い / 両方ある、はどちらも受け付けない。
        raise CleanupError("--run-id か --all のどちらか一方を指定してください。")
    if run_id is None:
        return r"e2euser\_%@example.com"
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise CleanupError("--run-id は英小文字・数字・ハイフンだけにしてください。")
    return rf"e2euser\_%\_{run_id}@example.com"


def _ids(session: Session, sql: str, params: dict[str, Any]) -> list[uuid.UUID]:
    return [row[0] for row in session.execute(text(sql), params).all()]


def _count_all(session: Session, checks: dict[str, str], params: dict[str, Any]) -> dict[str, int]:
    return {
        name: int(session.execute(text(sql), params).scalar_one()) for name, sql in checks.items()
    }


def _count_reset_attempts(session: Session, pattern: str) -> int:
    """対象メールのパターンに合うパスワード再設定の試行記録の件数。"""
    return int(
        session.execute(
            text("SELECT count(*) FROM password_reset_attempts WHERE email LIKE :p"),
            {"p": pattern},
        ).scalar_one()
    )


def _collect_keys(
    session: Session, params: dict[str, Any], pending_grace: timedelta
) -> tuple[list[tuple[str, datetime | None]], list[str]]:
    """消してよい画像キーと、対象外も参照しているので残すキーを返す。"""
    keys: dict[str, datetime | None] = {}
    for (key,) in session.execute(text(_OWNED_KEYS_SQL), params).all():
        if key:
            keys[key] = None
    uploads = session.execute(
        text(f"SELECT key, status, expires_at FROM uploads WHERE user_id = {_U}"), params
    ).all()
    for key, status, expires_at in uploads:
        if key in keys:
            continue
        # PUT がまだ終わっていないかもしれない pending は、実削除を少し遅らせる
        # （services/account.py の collect_account_keys と同じ扱い）。
        keys[key] = expires_at + pending_grace if status == "pending" else None

    deletable: list[tuple[str, datetime | None]] = []
    shared: list[str] = []
    for key, delete_after in sorted(keys.items()):
        is_shared = session.execute(text(_SHARED_KEY_SQL), {**params, "k": key}).scalar_one()
        if is_shared:
            shared.append(key)
        else:
            deletable.append((key, delete_after))
    return deletable, shared


def cleanup(
    session: Session, pattern: str, *, dry_run: bool, pending_grace: timedelta
) -> CleanupReport:
    """1 トランザクションで「ロック → 巻き添え確認 → 画像キーをキューへ → DELETE」を行う。

    巻き添えがあれば何も消さずに ``CleanupError``。消した後は残数を数え、0 でなければ
    ``CleanupError``。dry-run は数えるだけでロールバックする。
    """
    users = _ids(
        session,
        "SELECT id FROM users WHERE email LIKE :p ORDER BY id FOR UPDATE",
        {"p": pattern},
    )
    params: dict[str, Any] = {"u": users, "r": []}
    recipes = _ids(
        session, f"SELECT id FROM recipes WHERE user_id = {_U} ORDER BY id FOR UPDATE", params
    )
    params["r"] = recipes

    collateral = _count_all(session, COLLATERAL_CHECKS, params)
    image_keys, shared_keys = _collect_keys(session, params, pending_grace)
    report = CleanupReport(users, recipes, collateral, image_keys, shared_keys)
    report.reset_attempts = _count_reset_attempts(session, pattern)

    if dry_run:
        session.rollback()
        return report
    if report.has_collateral:
        session.rollback()
        raise CleanupError(f"E2E 以外の行に触れるため、何も消しませんでした: {collateral}")

    for key, delete_after in image_keys:
        enqueue_object_deletion(session, key, DELETION_REASON, delete_after=delete_after)
    # enqueue_object_deletion は uploads 行の削除を ORM の「保留中の操作」として積む。
    # 先に書き出しておかないと、次の DELETE の CASCADE が同じ行を先に消してしまい、
    # コミット時の ORM の削除が 0 行になって SQLAlchemy が警告を出す。
    session.flush()
    # パスワード再設定の試行記録は users に紐付かない（メールで記録）ので、CASCADE では
    # 消えない。同じトランザクションで、ユーザーを消す前に対象メールの分を消す。
    # 未登録メールで試した記録も同じメールのパターンに入るので、ここで一緒に消える。
    session.execute(text("DELETE FROM password_reset_attempts WHERE email LIKE :p"), {"p": pattern})
    session.execute(text(f"DELETE FROM users WHERE id = {_U}"), params)
    session.commit()
    report.deleted = True

    remaining = _count_all(session, RESIDUAL_CHECKS, params)
    remaining["users"] = int(
        session.execute(
            text("SELECT count(*) FROM users WHERE email LIKE :p"), {"p": pattern}
        ).scalar_one()
    )
    remaining["password_reset_attempts"] = _count_reset_attempts(session, pattern)
    session.rollback()
    left = {name: n for name, n in remaining.items() if n}
    if left:
        raise CleanupError(f"後始末の後に残っている行があります: {left}")
    return report


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="E2E テストのデータ（e2euser_）を削除する")
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--run-id", help="1 回の E2E 実行分だけを消す（メール末尾の _<run-id>）")
    target.add_argument(
        "--all", action="store_true", help=f"e2euser_ を全部消す（{ALLOW_ALL_ENV}=1 が必要）"
    )
    parser.add_argument("--dry-run", action="store_true", help="件数を表示するだけで消さない")
    parser.add_argument("--yes", action="store_true", help="確認なしで実行する")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """コマンドの入口。成功で 0、安全装置・後始末の失敗で 1、引数の誤りで 2 を返す。"""
    args = _parse_args(argv)
    if args.all and os.environ.get(ALLOW_ALL_ENV) != "1":
        print(f"--all は {ALLOW_ALL_ENV}=1 のときだけ使えます。", file=sys.stderr)
        return 2
    if not args.dry_run and not args.yes:
        print(
            "削除するには --yes を付けてください（件数だけ見るなら --dry-run）。", file=sys.stderr
        )
        return 2

    # 設定と DB は、引数を確かめた後に読み込む（--help だけで接続しないように）。
    from app.config import settings
    from app.db import engine

    try:
        pattern = email_pattern(args.run_id, all_users=args.all)
    except CleanupError as exc:
        print(exc, file=sys.stderr)
        return 2
    try:
        assert_cleanup_target(settings.APP_ENV, settings.DATABASE_URL)
    except CleanupError as exc:
        print(exc, file=sys.stderr)
        return 1

    url = make_url(settings.DATABASE_URL)
    print(f"接続先: host={url.host} db={url.database} / 対象: {pattern}")
    grace = timedelta(seconds=settings.UPLOAD_PENDING_TTL_SECONDS)
    with Session(engine) as session:
        try:
            report = cleanup(session, pattern, dry_run=args.dry_run, pending_grace=grace)
        except CleanupError as exc:
            print(exc, file=sys.stderr)
            return 1

    print(
        f"ユーザー {len(report.users)} 件 / レシピ {len(report.recipes)} 件 / "
        f"削除キューに積む画像 {len(report.image_keys)} 件 / 共有のため残す画像 "
        f"{len(report.shared_keys)} 件 / パスワード再設定の試行記録 {report.reset_attempts} 件 / "
        f"巻き添え {report.collateral}"
    )
    if args.dry_run:
        print("dry-run のため何も消していません。")
        return 1 if report.has_collateral else 0
    print("後始末が完了しました（残数 0）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
