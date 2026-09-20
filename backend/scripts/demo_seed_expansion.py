"""READMEデモを10件規模へ拡張するための固定データ定義。"""
# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlmodel import Session, select

from app import storage
from app.config import settings
from app.db import engine
from app.models.favorite import Favorite
from app.models.follow import Follow
from app.models.ingredient import Ingredient
from app.models.ingredient_group import IngredientGroup
from app.models.notification import Notification
from app.models.recipe import Recipe
from app.models.recipe_comment import RecipeComment
from app.models.step import Step
from app.models.upload import Upload
from app.models.user import User
from app.security import hash_password, hash_security_answer
from app.text_normalize import normalize_search_text
from scripts.seed_demo import DEMO_EMAILS, DEMO_PASSWORD, assert_demo_target

ADDITIONAL_USERS = (
    ("demo.ema@example.com", "デモパスタ えま"),
    ("demo.riku@example.com", "デモ魚料理 りく"),
    ("demo.noa@example.com", "デモスープ のあ"),
    ("demo.yui@example.com", "デモお弁当 ゆい"),
    ("demo.sora@example.com", "デモサラダ そら"),
    ("demo.mei@example.com", "デモ洋食 めい"),
    ("demo.kai@example.com", "デモおやつ かい"),
)

ADDITIONAL_RECIPES = (
    ("tomato-pasta", "トマトとにんにくのパスタ"),
    ("miso-salmon", "鮭の味噌焼き"),
    ("minestrone", "たっぷり野菜のミネストローネ"),
    ("teriyaki-bento", "鶏の照り焼き弁当"),
    ("tofu-salad", "豆腐とアボカドのごまサラダ"),
    ("mushroom-risotto", "きのこのクリームリゾット"),
    ("apple-crumble", "りんごとシナモンのクランブル"),
)

# 相互フォロー、片方向フォロー、未フォローを混在させる。
# 基本デモの3ユーザー間の関係は ``seed_demo.py`` が作成するため、ここでは
# 拡張ユーザーが関係する辺だけを定義する。
ADDITIONAL_FOLLOWS = (
    ("demo.ema@example.com", "demo.chef@example.com"),
    ("demo.ema@example.com", "demo.riku@example.com"),
    ("demo.riku@example.com", "demo.ema@example.com"),
    ("demo.riku@example.com", "demo.chef@example.com"),
    ("demo.noa@example.com", "demo.chef@example.com"),
    ("demo.noa@example.com", "demo.riku@example.com"),
    ("demo.noa@example.com", "demo.yui@example.com"),
    ("demo.yui@example.com", "demo.chef@example.com"),
    ("demo.sora@example.com", "demo.chef@example.com"),
    ("demo.sora@example.com", "demo.noa@example.com"),
    ("demo.mei@example.com", "demo.sora@example.com"),
)

ADDITIONAL_COMMENTS = (
    "tomato-pasta",
    "miso-salmon",
    "minestrone",
    "teriyaki-bento",
    "tofu-salad",
    "mushroom-risotto",
)
ADDITIONAL_NOTIFICATIONS = ADDITIONAL_COMMENTS

UNFOLLOWED_USER_EMAIL = "demo.kai@example.com"
UNFAVORITED_RECIPE_SLUG = "apple-crumble"

_ASSET_DIR = Path(__file__).resolve().parents[1] / "demo_assets"
_RECIPE_DATA = (
    (
        "tomato-pasta",
        "トマトとにんにくのパスタ",
        "demo.ema@example.com",
        "ミニトマト",
        "パスタをソースに絡めます。",
    ),
    (
        "miso-salmon",
        "鮭の味噌焼き",
        "demo.riku@example.com",
        "生鮭",
        "味噌だれを塗りながら焼きます。",
    ),
    (
        "minestrone",
        "たっぷり野菜のミネストローネ",
        "demo.noa@example.com",
        "玉ねぎ",
        "野菜を煮込み、味を整えます。",
    ),
    (
        "teriyaki-bento",
        "鶏の照り焼き弁当",
        "demo.yui@example.com",
        "鶏もも肉",
        "たれを煮詰めて照りを出します。",
    ),
    (
        "tofu-salad",
        "豆腐とアボカドのごまサラダ",
        "demo.sora@example.com",
        "木綿豆腐",
        "具材にごまだれをかけます。",
    ),
    (
        "mushroom-risotto",
        "きのこのクリームリゾット",
        "demo.mei@example.com",
        "しめじ",
        "少しずつ水分を加えて煮詰めます。",
    ),
    (
        "apple-crumble",
        "りんごとシナモンのクランブル",
        "demo.kai@example.com",
        "りんご",
        "オーブンで焼き色が付くまで焼きます。",
    ),
)


def seed_demo_expansion() -> str:
    """既存の基本デモへ7ユーザー・7レシピ等を追加する（冪等）。"""
    assert_demo_target(settings.APP_ENV, settings.DATABASE_URL)
    with Session(engine) as session:
        if (
            session.exec(select(User).where(User.email == ADDITIONAL_USERS[0][0])).first()
            is not None
        ):
            _rebuild_demo_follows(session)
            session.commit()
            return "拡張デモデータは既に投入されています（変更なし）。"

    storage.ensure_bucket()
    image_sizes: dict[str, int] = {}
    for slug, *_ in _RECIPE_DATA:
        data = (_ASSET_DIR / f"{slug}.png").read_bytes()
        storage.put_object(f"private/demo/{slug}.png", data, "image/png")
        image_sizes[slug] = len(data)

    with Session(engine) as session:
        now = datetime.now(UTC)
        users = {
            email: User(
                email=email,
                password_hash=hash_password(DEMO_PASSWORD),
                display_name=name,
                bio="README用の拡張デモアカウントです。",
                security_question="好きな料理は？",
                security_answer_hash=hash_security_answer("カレー"),
            )
            for email, name in ADDITIONAL_USERS
        }
        session.add_all(users.values())
        session.flush()
        recipes: dict[str, Recipe] = {}
        for slug, title, email, ingredient, first_step in _RECIPE_DATA:
            key = f"private/demo/{slug}.png"
            recipe = Recipe(
                user_id=users[email].id,
                title=title,
                title_normalized=normalize_search_text(title),
                description=f"手軽に作れる{title}のデモレシピです。",
                servings=2,
                is_public=True,
                thumbnail_key=key,
            )
            session.add(recipe)
            session.flush()
            recipes[slug] = recipe
            group = IngredientGroup(recipe_id=recipe.id, name=None, position=1)
            session.add(group)
            session.flush()
            session.add_all(
                [
                    Ingredient(
                        recipe_id=recipe.id,
                        group_id=group.id,
                        name=ingredient,
                        name_normalized=normalize_search_text(ingredient),
                        quantity=1,
                        unit="個",
                        position=1,
                    ),
                    Step(recipe_id=recipe.id, position=1, body=first_step, image_key=key),
                    Step(recipe_id=recipe.id, position=2, body="器に盛り付けて完成です。"),
                ]
            )
            session.add(
                Upload(
                    user_id=recipe.user_id,
                    key=key,
                    status="consumed",
                    content_type="image/png",
                    size_bytes=image_sizes[slug],
                    expires_at=now + timedelta(days=1),
                )
            )
        session.flush()
        all_users = _demo_users(session)
        for follower, followee in ADDITIONAL_FOLLOWS:
            session.add(
                Follow(follower_id=all_users[follower].id, followee_id=all_users[followee].id)
            )
        _recalculate_follow_counts(session, all_users)
        emails = list(users)
        for slug, email in zip((item[0] for item in _RECIPE_DATA[:-1]), emails[:6], strict=True):
            session.add(Favorite(user_id=users[email].id, recipe_id=recipes[slug].id))
            recipes[slug].favorite_count += 1
        for slug, email in zip(ADDITIONAL_COMMENTS, emails[:6], strict=True):
            session.add(
                RecipeComment(
                    recipe_id=recipes[slug].id,
                    user_id=users[email].id,
                    body="作りやすく、おいしくできました。",
                )
            )
        for slug, email in zip(ADDITIONAL_NOTIFICATIONS, emails[:6], strict=True):
            session.add(
                Notification(
                    user_id=recipes[slug].user_id,
                    actor_id=users[email].id,
                    type="recipe_favorited",
                    recipe_id=recipes[slug].id,
                )
            )
        session.commit()
    return "拡張デモデータを投入しました。"


def _demo_users(session: Session) -> dict[str, User]:
    """基本・拡張を合わせた10件のデモユーザーをメールアドレスで取得する。"""
    emails = (*DEMO_EMAILS, *(email for email, _ in ADDITIONAL_USERS))
    return {user.email: user for user in session.exec(select(User)).all() if user.email in emails}


def _rebuild_demo_follows(session: Session) -> None:
    """拡張ユーザーが関わるフォローを固定パターンへ戻す。"""
    users = _demo_users(session)
    additional_ids = {users[email].id for email, _ in ADDITIONAL_USERS}
    for follow in session.exec(select(Follow)).all():
        if follow.follower_id in additional_ids or follow.followee_id in additional_ids:
            session.delete(follow)
    session.flush()
    for follower, followee in ADDITIONAL_FOLLOWS:
        session.add(Follow(follower_id=users[follower].id, followee_id=users[followee].id))
    _recalculate_follow_counts(session, users)


def _recalculate_follow_counts(session: Session, users: dict[str, User]) -> None:
    """デモユーザーのフォロー集計値を、実際の関係テーブルから再計算する。"""
    user_ids = {user.id for user in users.values()}
    users_by_id = {user.id: user for user in users.values()}
    for user in users.values():
        user.following_count = 0
        user.follower_count = 0
    for follow in session.exec(select(Follow)).all():
        if follow.follower_id in user_ids:
            users_by_id[follow.follower_id].following_count += 1
        if follow.followee_id in user_ids:
            users_by_id[follow.followee_id].follower_count += 1


if __name__ == "__main__":
    print(seed_demo_expansion())
