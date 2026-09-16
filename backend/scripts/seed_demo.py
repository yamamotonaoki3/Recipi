"""README 用のデモデータを、専用 DB にだけ投入するスクリプト。

実行例（リポジトリルートで APP_ENV=demo を設定後）::

    cd backend
    alembic upgrade head
    python -m scripts.seed_demo

開発 DB を誤って汚さないよう、``APP_ENV=demo`` と DB 名の両方を検証する。
同じメールアドレスのデモユーザーが既にいれば何も変更せず成功するため、再実行も安全。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

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
from app.models.recipe_view import RecipeView
from app.models.step import Step
from app.models.upload import Upload
from app.models.user import User
from app.security import hash_password, hash_security_answer
from app.text_normalize import normalize_search_text

DEMO_PASSWORD = "DemoPass123!"
DEMO_EMAILS = (
    "demo.chef@example.com",
    "demo.foodie@example.com",
    "demo.beginner@example.com",
)
_ASSET_DIR = Path(__file__).resolve().parents[1] / "demo_assets"
# デモのレシピ画像も「レシピの画像」なので非公開側に置く（Issue #185）。
# 表示は署名付き URL になる。
_IMAGE_KEYS = {
    "curry": "private/demo/recipe-chicken-curry.png",
    "salmon": "private/demo/recipe-salmon-bowl.png",
}


def assert_demo_target(app_env: str, database_url: str) -> None:
    """デモ専用環境以外の実行を明示的に拒否する。"""
    database_name = urlparse(database_url).path.rstrip("/").rsplit("/", 1)[-1].lower()
    if app_env != "demo" or "demo" not in database_name:
        raise RuntimeError(
            "デモ seed は APP_ENV=demo かつ DB 名に demo を含む接続先でのみ実行できます。"
        )


def _put_demo_images() -> dict[str, int]:
    """同梱した生成画像を、固定キーで MinIO/S3 に冪等に配置する。

    キーが固定なので、途中で失敗して再実行しても**同じキーに上書きされるだけ**で、
    孤児のオブジェクトは増えない。
    """
    storage.ensure_bucket()
    image_files = {"curry": "curry.png", "salmon": "salmon-bowl.png"}
    sizes: dict[str, int] = {}
    for name, filename in image_files.items():
        data = (_ASSET_DIR / filename).read_bytes()
        storage.put_object(_IMAGE_KEYS[name], data, "image/png")
        sizes[name] = len(data)
    return sizes


def _user(email: str, display_name: str, bio: str) -> User:
    return User(
        email=email,
        password_hash=hash_password(DEMO_PASSWORD),
        display_name=display_name,
        bio=bio,
        security_question="好きな料理は？",
        security_answer_hash=hash_security_answer("カレー"),
    )


def seed_demo() -> str:
    """デモデータを 1 トランザクションで作成し、結果メッセージを返す。"""
    assert_demo_target(settings.APP_ENV, settings.DATABASE_URL)

    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == DEMO_EMAILS[0])).first()
        if existing is not None:
            return "デモデータは既に投入されています（変更なし）。"

    image_sizes = _put_demo_images()
    now = datetime.now(UTC)

    with Session(engine) as session:
        chef = _user(
            DEMO_EMAILS[0],
            "デモ料理人 あかり",
            "平日のごはんを、手軽でおいしく。\n旬の野菜を使ったレシピを投稿しています。",
        )
        foodie = _user(
            DEMO_EMAILS[1],
            "デモ食べ歩き みなと",
            "おいしいものを探すのが好きです。\n作ってよかったレシピに感想を残します。",
        )
        beginner = _user(
            DEMO_EMAILS[2],
            "デモ初心者 ひなた",
            "料理を始めたばかりです。簡単なレシピから挑戦中！",
        )
        session.add_all([chef, foodie, beginner])
        session.flush()

        curry = Recipe(
            user_id=chef.id,
            title="ごろごろ野菜のチキンカレー",
            title_normalized=normalize_search_text("ごろごろ野菜のチキンカレー"),
            description="野菜の甘みを楽しめる、週末に作りたいチキンカレーです。",
            servings=4,
            is_public=True,
            thumbnail_key=_IMAGE_KEYS["curry"],
            favorite_count=2,
            comment_count=2,
            created_at=now - timedelta(days=4),
            updated_at=now - timedelta(days=4),
        )
        salmon = Recipe(
            user_id=foodie.id,
            title="サーモンとアボカドの彩り丼",
            title_normalized=normalize_search_text("サーモンとアボカドの彩り丼"),
            description="火を使わずに作れる、休日のランチにぴったりな海鮮丼です。",
            servings=2,
            is_public=True,
            thumbnail_key=_IMAGE_KEYS["salmon"],
            favorite_count=1,
            comment_count=1,
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=2),
        )
        pancakes = Recipe(
            user_id=chef.id,
            title="ふんわりヨーグルトパンケーキ",
            title_normalized=normalize_search_text("ふんわりヨーグルトパンケーキ"),
            description="ヨーグルトを加えて軽い食感に仕上げる朝食パンケーキです。",
            servings=2,
            is_public=True,
            favorite_count=1,
            comment_count=1,
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
        )
        session.add_all([curry, salmon, pancakes])
        session.flush()

        curry_group = IngredientGroup(recipe_id=curry.id, name=None, position=1)
        salmon_group = IngredientGroup(recipe_id=salmon.id, name=None, position=1)
        pancake_group = IngredientGroup(recipe_id=pancakes.id, name=None, position=1)
        session.add_all([curry_group, salmon_group, pancake_group])
        session.flush()
        session.add_all(
            [
                Ingredient(
                    recipe_id=curry.id,
                    group_id=curry_group.id,
                    name="鶏もも肉",
                    name_normalized=normalize_search_text("鶏もも肉"),
                    quantity=400,
                    unit="g",
                    position=1,
                ),
                Ingredient(
                    recipe_id=curry.id,
                    group_id=curry_group.id,
                    name="玉ねぎ",
                    name_normalized=normalize_search_text("玉ねぎ"),
                    quantity=1,
                    unit="個",
                    position=2,
                ),
                Ingredient(
                    recipe_id=curry.id,
                    group_id=curry_group.id,
                    name="市販のカレールウ",
                    name_normalized=normalize_search_text("市販のカレールウ"),
                    quantity=4,
                    unit="皿分",
                    position=3,
                ),
                Ingredient(
                    recipe_id=salmon.id,
                    group_id=salmon_group.id,
                    name="刺身用サーモン",
                    name_normalized=normalize_search_text("刺身用サーモン"),
                    quantity=200,
                    unit="g",
                    position=1,
                ),
                Ingredient(
                    recipe_id=salmon.id,
                    group_id=salmon_group.id,
                    name="アボカド",
                    name_normalized=normalize_search_text("アボカド"),
                    quantity=1,
                    unit="個",
                    position=2,
                ),
                Ingredient(
                    recipe_id=pancakes.id,
                    group_id=pancake_group.id,
                    name="ホットケーキミックス",
                    name_normalized=normalize_search_text("ホットケーキミックス"),
                    quantity=150,
                    unit="g",
                    position=1,
                ),
                Ingredient(
                    recipe_id=pancakes.id,
                    group_id=pancake_group.id,
                    name="プレーンヨーグルト",
                    name_normalized=normalize_search_text("プレーンヨーグルト"),
                    quantity=80,
                    unit="g",
                    position=2,
                ),
            ]
        )
        session.add_all(
            [
                Step(
                    recipe_id=curry.id,
                    position=1,
                    body="鶏肉と野菜を食べやすい大きさに切ります。",
                    image_key=_IMAGE_KEYS["curry"],
                ),
                Step(
                    recipe_id=curry.id,
                    position=2,
                    body="鍋で炒め、水とルウを加えてとろみが出るまで煮込みます。",
                ),
                Step(
                    recipe_id=salmon.id,
                    position=1,
                    body="温かいごはんを器に盛り、サーモンとアボカドを並べます。",
                    image_key=_IMAGE_KEYS["salmon"],
                ),
                Step(
                    recipe_id=salmon.id,
                    position=2,
                    body="お好みでごま、のり、しょうゆをかけて完成です。",
                ),
                Step(
                    recipe_id=pancakes.id,
                    position=1,
                    body="材料を混ぜ、弱火のフライパンで両面を焼きます。",
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
                Favorite(
                    user_id=beginner.id, recipe_id=pancakes.id, created_at=now - timedelta(hours=12)
                ),
            ]
        )
        chef.following_count, chef.follower_count = 1, 2
        foodie.following_count, foodie.follower_count = 1, 1
        beginner.following_count, beginner.follower_count = 1, 0

        curry_comment_foodie = RecipeComment(
            recipe_id=curry.id,
            user_id=foodie.id,
            body="野菜がたっぷりで、家族にも好評でした！",
            created_at=now - timedelta(days=3),
            updated_at=now - timedelta(days=3),
        )
        curry_comment_beginner = RecipeComment(
            recipe_id=curry.id,
            user_id=beginner.id,
            body="初めてでもおいしく作れました。",
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=2),
        )
        salmon_comment_chef = RecipeComment(
            recipe_id=salmon.id,
            user_id=chef.id,
            body="彩りがきれいで、ランチにぴったりですね。",
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
        )
        pancake_comment_foodie = RecipeComment(
            recipe_id=pancakes.id,
            user_id=foodie.id,
            body="ふんわり食感が最高でした。",
            created_at=now - timedelta(hours=10),
            updated_at=now - timedelta(hours=10),
        )
        session.add_all(
            [
                curry_comment_foodie,
                curry_comment_beginner,
                salmon_comment_chef,
                pancake_comment_foodie,
            ]
        )
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
                    actor_id=beginner.id,
                    type="recipe_favorited",
                    recipe_id=curry.id,
                    created_at=now - timedelta(days=2),
                ),
                Notification(
                    user_id=chef.id,
                    actor_id=foodie.id,
                    type="recipe_commented",
                    recipe_id=curry.id,
                    comment_id=curry_comment_foodie.id,
                    created_at=now - timedelta(days=3),
                ),
                Notification(
                    user_id=foodie.id,
                    actor_id=chef.id,
                    type="followee_new_recipe",
                    recipe_id=pancakes.id,
                    read_at=now - timedelta(hours=6),
                    created_at=now - timedelta(hours=12),
                ),
            ]
        )
        session.add_all(
            [
                RecipeView(
                    user_id=foodie.id, recipe_id=curry.id, viewed_at=now - timedelta(hours=4)
                ),
                RecipeView(
                    user_id=foodie.id, recipe_id=pancakes.id, viewed_at=now - timedelta(hours=3)
                ),
                RecipeView(
                    user_id=beginner.id, recipe_id=salmon.id, viewed_at=now - timedelta(hours=2)
                ),
            ]
        )
        for name, image_key in _IMAGE_KEYS.items():
            session.add(
                Upload(
                    user_id=chef.id if name == "curry" else foodie.id,
                    key=image_key,
                    status="consumed",
                    content_type="image/png",
                    size_bytes=image_sizes[name],
                    expires_at=now + timedelta(days=1),
                )
            )
        session.commit()

    return "デモデータを投入しました。ログイン情報は README を確認してください。"


if __name__ == "__main__":
    print(seed_demo())
