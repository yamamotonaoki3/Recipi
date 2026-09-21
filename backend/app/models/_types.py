"""モデル間で共有するSQLAlchemy型定義。"""

from __future__ import annotations

from datetime import datetime
from typing import cast

import sqlalchemy as sa

# SQLModelのsa_typeは型クラスを型注釈に要求するが、timezone=Trueは
# インスタンス設定で指定するため、実行時の値を明示的に型付けする。
UTC_DATETIME = cast(type[datetime], sa.DateTime(timezone=True))
