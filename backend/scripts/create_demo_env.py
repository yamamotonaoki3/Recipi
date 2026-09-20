"""README用のローカルデモ環境ファイルを安全に作成する。"""

from __future__ import annotations

import argparse
import secrets
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEMO_DATABASE_USER = "recipi_demo_user"
_DEMO_DATABASE_NAME = "recipi_demo"
_DEMO_DATABASE_PORT = 5433


def render_demo_env(
    *, database_password: str, minio_password: str, jwt_secret: str, log_hash_secret: str
) -> str:
    """デモ専用PostgreSQLへ接続する `.env.demo` の内容を返す。"""
    return f"""# README用ローカルデモ環境。自動生成された値なのでコミットしない。
APP_ENV=demo
DATABASE_URL=postgresql+psycopg://{_DEMO_DATABASE_USER}:{database_password}@localhost:{_DEMO_DATABASE_PORT}/{_DEMO_DATABASE_NAME}
POSTGRES_DB={_DEMO_DATABASE_NAME}
POSTGRES_USER={_DEMO_DATABASE_USER}
POSTGRES_PASSWORD={database_password}

JWT_SECRET_KEY={jwt_secret}
AUTH_COOKIE_SECURE=false
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_PATH=/api/v1/auth
CORS_ALLOW_ORIGINS=http://localhost:8081,http://localhost:8082,http://localhost:19006,http://localhost:1420,http://tauri.localhost,tauri://localhost
CORS_ALLOW_CREDENTIALS=true

S3_ENDPOINT_URL=http://localhost:9002
S3_REGION=us-east-1
S3_BUCKET=recipi-demo-images
S3_ACCESS_KEY_ID=recipi_demo_minio
S3_SECRET_ACCESS_KEY={minio_password}
S3_PUBLIC_URL_BASE=http://localhost:9002/recipi-demo-images
MINIO_ROOT_USER=recipi_demo_minio
MINIO_ROOT_PASSWORD={minio_password}

LOG_LEVEL=INFO
LOG_FORMAT=text
LOG_HASH_SECRET={log_hash_secret}

# Ollama・GPU・外部APIを使わず、決定的な校正候補だけを返す。
AI_PROVIDER=stub
"""


def create_demo_env(target: Path, *, force: bool = False) -> bool:
    """`.env.demo` を作る。既存ファイルは `force` なしでは上書きしない。"""
    if target.exists() and not force:
        return False

    target.write_text(
        render_demo_env(
            database_password=secrets.token_urlsafe(32),
            minio_password=secrets.token_urlsafe(32),
            jwt_secret=secrets.token_urlsafe(48),
            log_hash_secret=secrets.token_urlsafe(48),
        ),
        encoding="utf-8",
    )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="README用の .env.demo を作成する")
    parser.add_argument("--force", action="store_true", help="既存 .env.demo を上書きする")
    parser.add_argument(
        "--output",
        type=Path,
        default=_REPO_ROOT / ".env.demo",
        help="出力先（既定: リポジトリルートの .env.demo）",
    )
    args = parser.parse_args()
    target: Path = args.output
    if create_demo_env(target, force=args.force):
        print(f"{target.name} を作成しました。")
    else:
        print(f"{target.name} は既に存在します。作り直す場合は --force を指定してください。")


if __name__ == "__main__":
    main()
