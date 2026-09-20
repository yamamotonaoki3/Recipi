"""README用デモDBへ、画像ストレージを使わないサンプルデータを投入する。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from sqlmodel import Session, select

from app.config import settings
from app.db import engine
from app.models.favorite import Favorite
from app.models.follow import Follow
from app.models.ingredient import Ingredient
from app.models.ingredient_group import IngredientGroup
from app.models.notification import Notification
from app.models.recipe import Recipe
from app.models.recipe_comment import RecipeComment
from app.models.recipe_view import RecipeView
from app.models.step import Step
from app.models.user import User
from app.security import hash_password, hash_security_answer
from app.text_normalize import normalize_search_text

DEMO_PASSWORD = "DemoPass123!"
DEMO_EMAILS = (
    "demo.chef@example.com",
    "demo.foodie@example.com",
    "demo.beginner@example.com",
)


def assert_demo_target(app_env: str, database_url: str) -> None:
    """デモ専用環境以外ではseedを拒否する。"""
    database_name = urlparse(database_url).path.rstrip("/").rsplit("/", 1)[-1].lower()
    if app_env != "demo" or "demo" not in database_name:
        raise RuntimeError(
            "デモ seed は APP_ENV=demo かつ DB 名に demo を含む接続先でのみ実行できます。"
        )


def _user(email: str, display_name: str) -> User:
    return User(
        email=email,
        password_hash=hash_password(DEMO_PASSWORD),
        display_name=display_name,
        bio="README用のローカルデモアカウントです。",
        security_question="好きな料理は？",
        security_answer_hash=hash_security_answer("カレー"),
    )


def seed_demo_db() -> str:
    """デモデータを冪等に投入する。画像・MinIOには接続しない。"""
    assert_demo_target(settings.APP_ENV, settings.DATABASE_URL)

    with Session(engine) as session:
        if session.exec(select(User).where(User.email == DEMO_EMAILS[0])).first() is not None:
            return "デモデータは既に投入されています（変更なし）。"

        now = datetime.now(UTC)
        chef = _user(DEMO_EMAILS[0], "デモ料理人 あかり")
        foodie = _user(DEMO_EMAILS[1], "デモ食べ歩き みなと")
        beginner = _user(DEMO_EMAILS[2], "デモ初心者 ひなた")
        session.add_all([chef, foodie, beginner])
        session.flush()

        recipes = [
            Recipe(
                user_id=chef.id,
                title="ごろごろ野菜のチキンカレー",
                title_normalized=normalize_search_text("ごろごろ野菜のチキンカレー"),
                description="野菜の甘みを楽しめるチキンカレーです。",
                servings=4,
                is_public=True,
                thumbnail_key=None,
                favorite_count=2,
                comment_count=2,
                created_at=now - timedelta(days=4),
                updated_at=now - timedelta(days=4),
            ),
            Recipe(
                user_id=foodie.id,
                title="サーモンとアボカドの彩り丼",
                title_normalized=normalize_search_text("サーモンとアボカドの彩り丼"),
                description="火を使わずに作れる休日のランチです。",
                servings=2,
                is_public=True,
                thumbnail_key=None,
                favorite_count=1,
                comment_count=1,
                created_at=now - timedelta(days=2),
                updated_at=now - timedelta(days=2),
            ),
            Recipe(
                user_id=chef.id,
                title="ふんわりヨーグルトパンケーキ",
                title_normalized=normalize_search_text("ふんわりヨーグルトパンケーキ"),
                description="軽い食感に仕上げる朝食パンケーキです。",
                servings=2,
                is_public=True,
                thumbnail_key=None,
                favorite_count=1,
                comment_count=1,
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
            ),
        ]
        session.add_all(recipes)
        session.flush()
        curry, salmon, pancakes = recipes

        groups = [IngredientGroup(recipe_id=recipe.id, name=None, position=1) for recipe in recipes]
        session.add_all(groups)
        session.flush()
        session.add_all(
            [
                Ingredient(
                    recipe_id=curry.id,
                    group_id=groups[0].id,
                    name="鶏もも肉",
                    name_normalized=normalize_search_text("鶏もも肉"),
                    quantity=400,
                    unit="g",
                    position=1,
                ),
                Ingredient(
                    recipe_id=salmon.id,
                    group_id=groups[1].id,
                    name="刺身用サーモン",
                    name_normalized=normalize_search_text("刺身用サーモン"),
                    quantity=200,
                    unit="g",
                    position=1,
                ),
                Ingredient(
                    recipe_id=pancakes.id,
                    group_id=groups[2].id,
                    name="ホットケーキミックス",
                    name_normalized=normalize_search_text("ホットケーキミックス"),
                    quantity=150,
                    unit="g",
                    position=1,
                ),
            ]
        )
        session.add_all(
            [
                Step(
                    recipe_id=curry.id,
                    position=1,
                    body="鶏肉と野菜を食べやすい大きさに切ります。",
                    image_key=None,
                ),
                Step(
                    recipe_id=curry.id,
                    position=2,
                    body="鍋で炒め、水とルウを加えて煮込みます。",
                    image_key=None,
                ),
                Step(
                    recipe_id=salmon.id,
                    position=1,
                    body="ごはんにサーモンとアボカドを並べます。",
                    image_key=None,
                ),
                Step(
                    recipe_id=pancakes.id,
                    position=1,
                    body="材料を混ぜ、弱火で両面を焼きます。",
                    image_key=None,
                ),
            ]
        )
        session.add_all(
            [
                Follow(
                    follower_id=foodie.id, followee_id=chef.id, created_at=now - timedelta(days=5)
                ),
                Follow(
                    follower_id=beginner.id, followee_id=chef.id, created_at=now - timedelta(days=3)
                ),
                Follow(
                    follower_id=chef.id, followee_id=foodie.id, created_at=now - timedelta(days=2)
                ),
                Favorite(user_id=foodie.id, recipe_id=curry.id, created_at=now - timedelta(days=3)),
                Favorite(
                    user_id=beginner.id, recipe_id=curry.id, created_at=now - timedelta(days=2)
                ),
                Favorite(user_id=chef.id, recipe_id=salmon.id, created_at=now - timedelta(days=1)),
            ]
        )
        chef.following_count, chef.follower_count = 1, 2
        foodie.following_count, foodie.follower_count = 1, 1
        beginner.following_count, beginner.follower_count = 1, 0

        comment = RecipeComment(
            recipe_id=curry.id,
            user_id=foodie.id,
            body="野菜がたっぷりで、家族にも好評でした！",
            created_at=now - timedelta(days=3),
            updated_at=now - timedelta(days=3),
        )
        session.add(comment)
        session.flush()
        session.add_all(
            [
                Notification(
                    user_id=chef.id,
                    actor_id=foodie.id,
                    type="followed",
                    created_at=now - timedelta(days=5),
                ),
                Notification(
                    user_id=chef.id,
                    actor_id=foodie.id,
                    type="recipe_commented",
                    recipe_id=curry.id,
                    comment_id=comment.id,
                    created_at=now - timedelta(days=3),
                ),
                RecipeView(
                    user_id=foodie.id, recipe_id=curry.id, viewed_at=now - timedelta(hours=4)
                ),
                RecipeView(
                    user_id=beginner.id, recipe_id=salmon.id, viewed_at=now - timedelta(hours=2)
                ),
            ]
        )
        session.commit()

    return "デモデータを投入しました。ログイン情報は README を確認してください。"


if __name__ == "__main__":
    print(seed_demo_db())
