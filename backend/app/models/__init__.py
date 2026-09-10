"""DB テーブルに対応する SQLModel モデルをまとめるパッケージ。

Alembic の `env.py` は `SQLModel.metadata` を見て autogenerate するが、
そのためには各モデルクラスが一度でも import されている必要がある。
ここで全モデルを re-export しておくことで、`import app.models` するだけで
`SQLModel.metadata` に全テーブルが登録される。
"""

from __future__ import annotations

from app.models.follow import Follow
from app.models.ingredient import Ingredient
from app.models.ingredient_group import IngredientGroup
from app.models.notification import Notification
from app.models.password_reset_attempt import PasswordResetAttempt
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.recipe import Recipe
from app.models.recipe_view import RecipeView
from app.models.refresh_token import RefreshToken
from app.models.step import Step
from app.models.unit import Unit
from app.models.upload import Upload
from app.models.user import User

__all__ = [
    "Follow",
    "Ingredient",
    "IngredientGroup",
    "Notification",
    "PasswordResetAttempt",
    "PendingStorageDeletion",
    "Recipe",
    "RecipeView",
    "RefreshToken",
    "Step",
    "Unit",
    "Upload",
    "User",
]
