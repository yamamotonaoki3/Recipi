"""Alembic のマイグレーション実行設定。

`alembic upgrade head` などを実行すると、このファイルが読み込まれて
「どの DB へ・どのモデル定義を正として」マイグレーションするかを決める。

Recipi での方針:
- 接続先 URL は alembic.ini ではなく **アプリの設定（app.config）** から取る。
  → .env.<APP_ENV> を 1 か所で管理できる（environment.md）。
- `target_metadata` は SQLModel のメタデータ。Phase 1 以降でモデルを
  `app/models/` に足していくと autogenerate の対象になる。
- ただし **DB レベルの制約が正**（data-model.md）。autogenerate で作った
  下書きは必ず人がレビューし、複合 FK・部分 index・CHECK・トリガーは
  手書きで補う（todo #43）。
"""

from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from alembic import context
from app.config import settings

config = context.config

# alembic.ini の [loggers] などを使ってロギングを設定する。
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 接続先はアプリ設定から注入する（alembic.ini の sqlalchemy.url は使わない）。
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# autogenerate が比較する「あるべきスキーマ」。
# Phase 1 以降で app.models（SQLModel テーブル定義）を import すると、
# その全モデルが SQLModel.metadata に登録されて autogenerate の対象になる。
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """DB につながずに SQL 文だけを出力するモード（`alembic upgrade --sql`）。"""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """実際に DB につないでマイグレーションを流すモード（通常こちら）。"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
