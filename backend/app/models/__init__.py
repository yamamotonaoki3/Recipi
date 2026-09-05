"""DB テーブルに対応する SQLModel モデルをまとめるパッケージ。

Alembic の `env.py` は `SQLModel.metadata` を見て autogenerate するが、
そのためには各モデルクラスが一度でも import されている必要がある。
ここで全モデルを re-export しておくことで、`import app.models` するだけで
`SQLModel.metadata` に全テーブルが登録される。
"""

from __future__ import annotations

from app.models.password_reset_attempt import PasswordResetAttempt
from app.models.refresh_token import RefreshToken
from app.models.user import User

__all__ = ["PasswordResetAttempt", "RefreshToken", "User"]
