"""性能テスト（k6）用のデータを投入するスクリプト（Issue #145）。

投入するもの（件数は引数で変えられる）:

- ユーザー ``perfuser_001@example.com`` 〜（既定 200 人）
- 公開レシピ（既定 3,000 件）。タイトルに ``[PERF_TEST]`` を付け、材料 3 つ・手順 3 つを持つ
- フォロー（1 人あたり 5 人）・お気に入り（1 人あたり 10 件）。カウント列もそろえる

実行例（リポジトリルートの ``.env.<APP_ENV>`` を読む。``backend`` で実行する）::

    cd backend
    APP_ENV=development python -m scripts.seed_perf --yes
    APP_ENV=development python -m scripts.seed_perf --users 50 --recipes 500 --yes

後始末は ``python -m scripts.cleanup_perf --yes``（残数 0 を確かめる）。

## なぜ件数を多めに入れるのか

データがほとんど無い DB で測ると、N+1 クエリや index の効いていない検索のような
「件数に比例して遅くなる」問題が数字に出ない。フィード・検索が普段より重くなる
状態を作ってから測る。

## 安全装置

``cleanup_e2e.assert_cleanup_target`` と同じ条件（APP_ENV が development / test で、
接続先がローカル）でしか動かない。すでに ``perfuser_`` がいる場合は何もしない
（二重投入で件数が狂うのを防ぐ。やり直すときは先に cleanup_perf を実行する）。
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.models.favorite import Favorite
from app.models.follow import Follow
from app.models.ingredient import Ingredient
from app.models.ingredient_group import IngredientGroup
from app.models.recipe import Recipe
from app.models.step import Step
from app.models.user import User
from app.text_normalize import normalize_search_text
from scripts.cleanup_e2e import CleanupError, assert_cleanup_target

# テスト専用の固定パスワード（グローバル CLAUDE.md「テストデータの標準要件」）。
# k6 側（perf/k6/lib/config.js）の既定値と同じ。
PERF_PASSWORD = "TestPass123!"
PERF_TAG = "[PERF_TEST]"
# cleanup_perf が使う LIKE パターン（`_` は 1 文字の意味なのでエスケープ）。
PERF_EMAIL_PATTERN = r"perfuser\_%@example.com"
VOCABULARY_PATH = Path(__file__).resolve().parents[1] / "perf" / "data" / "vocabulary.json"

# 乱数の種を固定して、何度投入しても同じデータになるようにする（測定を比べやすくする）。
_RANDOM_SEED = 145
INGREDIENTS_PER_RECIPE = 3
STEPS_PER_RECIPE = 3


@dataclass(frozen=True)
class SeedPlan:
    """投入する件数。"""

    users: int = 200
    recipes: int = 3000
    follows_per_user: int = 5
    favorites_per_user: int = 10


@dataclass
class SeedData:
    """DB に入れる行（モデルのインスタンス）の一式。"""

    users: list[User] = field(default_factory=list)
    recipes: list[Recipe] = field(default_factory=list)
    groups: list[IngredientGroup] = field(default_factory=list)
    ingredients: list[Ingredient] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    follows: list[Follow] = field(default_factory=list)
    favorites: list[Favorite] = field(default_factory=list)

    def insert_stages(self) -> list[list[Any]]:
        """外部キーの親から順に、段階ごとに分けた行（1 段階ずつ INSERT して flush する）。

        モデルは外部キーの列だけを持ち `relationship()` を定義していないので、
        まとめて `add_all` すると SQLAlchemy は親子の順番を決められず、子
        （favorites など）を親（users）より先に INSERT して外部キー違反になる
        （Issue #145 の CI で発生。seed_demo.py が段階ごとに flush するのと同じ理由）。
        """
        return [
            list(self.users),
            list(self.recipes),
            list(self.groups),
            [*self.ingredients, *self.steps, *self.follows, *self.favorites],
        ]


def perf_email(number: int) -> str:
    """``perfuser_001@example.com`` の形のメールアドレス（k6 の perfEmail と同じ規則）。"""
    return f"perfuser_{number:03d}@example.com"


def load_vocabulary(path: Path = VOCABULARY_PATH) -> dict[str, list[str]]:
    """料理名・材料名の語彙を読む（k6 と同じファイル）。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"dishes": list(data["dishes"]), "ingredients": list(data["ingredients"])}


def build_seed(
    plan: SeedPlan,
    vocabulary: dict[str, list[str]],
    *,
    now: datetime,
    password_hash: str,
    answer_hash: str,
) -> SeedData:
    """投入する行を組み立てる（DB には触らない純粋な関数。単体テストしやすくするため）。

    Argon2 のハッシュは 1 回の計算に時間がかかるので、呼び出し側で 1 回だけ計算した
    ものを全ユーザーで使い回す。
    """
    if plan.users < 1 or plan.recipes < 1:
        raise ValueError("users と recipes は 1 以上にしてください。")
    rng = random.Random(_RANDOM_SEED)
    data = SeedData()

    for n in range(1, plan.users + 1):
        data.users.append(
            User(
                email=perf_email(n),
                password_hash=password_hash,
                display_name=f"PerfUser {n:03d}",
                security_question="好きな食べ物は？",
                security_answer_hash=answer_hash,
                created_at=now - timedelta(days=120),
                updated_at=now - timedelta(days=120),
            )
        )

    dishes, ingredient_names = vocabulary["dishes"], vocabulary["ingredients"]
    for i in range(plan.recipes):
        # 新しい順に 30 分ずつずらす（3,000 件で約 2 か月分）。フィードは新着順なので、
        # 作成日時がそろっていないと並びの検証にならない。
        created_at = now - timedelta(minutes=30 * i)
        title = f"{PERF_TAG} {rng.choice(dishes)} {i + 1:04d}"
        recipe = Recipe(
            user_id=data.users[i % plan.users].id,
            title=title,
            title_normalized=normalize_search_text(title),
            description=f"{PERF_TAG} 性能テスト用のレシピです。",
            servings=rng.randint(1, 6),
            is_public=True,
            created_at=created_at,
            updated_at=created_at,
        )
        data.recipes.append(recipe)
        group = IngredientGroup(recipe_id=recipe.id, name=None, position=1)
        data.groups.append(group)
        for pos, name in enumerate(rng.sample(ingredient_names, INGREDIENTS_PER_RECIPE), start=1):
            data.ingredients.append(
                Ingredient(
                    recipe_id=recipe.id,
                    group_id=group.id,
                    name=name,
                    name_normalized=normalize_search_text(name),
                    quantity=Decimal(rng.randint(1, 5)),
                    unit="個",
                    position=pos,
                )
            )
        for pos in range(1, STEPS_PER_RECIPE + 1):
            data.steps.append(
                Step(recipe_id=recipe.id, position=pos, body=f"{PERF_TAG} 手順 {pos}")
            )

    # フォロー: n 番目の人が、次の k 人をフォローする（輪になるので全員が k 人ずつ）。
    k = min(plan.follows_per_user, plan.users - 1)
    for idx, user in enumerate(data.users):
        for step in range(1, k + 1):
            followee = data.users[(idx + step) % plan.users]
            data.follows.append(
                Follow(follower_id=user.id, followee_id=followee.id, created_at=now)
            )
        user.following_count = k
        user.follower_count = k

    # お気に入り: 自分以外のレシピからランダムに選ぶ。レシピ側のカウント列もそろえる。
    for idx, user in enumerate(data.users):
        candidates = [r for j, r in enumerate(data.recipes) if j % plan.users != idx]
        for recipe in rng.sample(candidates, min(plan.favorites_per_user, len(candidates))):
            data.favorites.append(Favorite(user_id=user.id, recipe_id=recipe.id, created_at=now))
            recipe.favorite_count += 1

    return data


def count_existing(session: Session) -> int:
    """すでにいる ``perfuser_`` の人数。"""
    return int(
        session.execute(
            text("SELECT count(*) FROM users WHERE email LIKE :p"), {"p": PERF_EMAIL_PATTERN}
        ).scalar_one()
    )


def seed(session: Session, data: SeedData) -> None:
    """1 トランザクションで投入する。すでに ``perfuser_`` がいれば何もしない。"""
    if count_existing(session) > 0:
        raise CleanupError(
            "perfuser_ のデータがすでにあります。やり直すときは先に "
            "`python -m scripts.cleanup_perf --yes` を実行してください。"
        )
    # 親の行を先に DB へ送ってから（flush）、それを参照する子を足す。commit は最後に 1 回
    # なので、途中で失敗すれば全部取り消される（1 トランザクション）。
    for rows in data.insert_stages():
        session.add_all(rows)
        session.flush()
    session.commit()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="性能テスト用のデータ（perfuser_）を投入する")
    parser.add_argument("--users", type=int, default=SeedPlan.users, help="ユーザー数")
    parser.add_argument("--recipes", type=int, default=SeedPlan.recipes, help="レシピ数")
    parser.add_argument("--yes", action="store_true", help="確認なしで実行する")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """コマンドの入口。成功で 0、安全装置に当たったら 1、引数の誤りで 2 を返す。"""
    args = _parse_args(argv)
    if not args.yes:
        print("投入するには --yes を付けてください。", file=sys.stderr)
        return 2
    if args.users < 1 or args.recipes < 1:
        print("--users と --recipes は 1 以上にしてください。", file=sys.stderr)
        return 2

    # 設定と DB は、引数を確かめた後に読み込む（--help だけで接続しないように）。
    from sqlalchemy.engine import make_url

    from app.config import settings
    from app.db import engine
    from app.security import hash_password, hash_security_answer

    try:
        assert_cleanup_target(settings.APP_ENV, settings.DATABASE_URL)
    except CleanupError as exc:
        print(str(exc).replace("E2E の後始末", "性能テストのデータ投入"), file=sys.stderr)
        return 1

    url = make_url(settings.DATABASE_URL)
    print(f"接続先: host={url.host} db={url.database}")
    plan = SeedPlan(users=args.users, recipes=args.recipes)
    data = build_seed(
        plan,
        load_vocabulary(),
        now=datetime.now(UTC),
        password_hash=hash_password(PERF_PASSWORD),
        answer_hash=hash_security_answer("ラーメン"),
    )
    with Session(engine) as session:
        try:
            seed(session, data)
        except CleanupError as exc:
            print(exc, file=sys.stderr)
            return 1
    print(
        f"投入しました: ユーザー {len(data.users)} / レシピ {len(data.recipes)} / "
        f"フォロー {len(data.follows)} / お気に入り {len(data.favorites)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
