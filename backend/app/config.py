"""アプリの設定（環境変数）を 1 か所にまとめるモジュール。

要件:
- 環境は APP_ENV（development / test / production）で切り替える。
- 実際の値は `.gitignore` 対象の `.env.<APP_ENV>` にだけ置く。
  （docs/requirements/environment.md）

仕組み:
- `pydantic-settings` の `BaseSettings` を継承した `Settings` クラスに、
  必要な環境変数を「型付きの属性」として宣言する。
- インスタンス化すると、環境変数 → `.env.<APP_ENV>` の順に値を読み込み、
  型変換とバリデーションをしてくれる。
- 他モジュールからは `from app.config import settings` で使う
  （`get_settings()` は関数として 1 回だけ生成しキャッシュする）。
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# production で使ってはいけない「明らかにダミーの」JWT 署名鍵。
# ソースに書いてある値で本番のトークンに署名できてしまうと、
# ソースを見た人が偽のトークンを作れてしまう。
_INSECURE_JWT_SECRETS = {"", "dev-only-not-a-real-secret", "changeme"}

# このファイル（app/config.py）から見た backend/ の 1 つ上 = リポジトリルート。
# `.env.development` などはリポジトリルートに置く（environment.md §3）。
_REPO_ROOT = Path(__file__).resolve().parents[2]

# APP_ENV は「どの .env ファイルを読むか」を決めるので、Settings の生成より
# 前に os.environ から直接読む。未設定なら development 扱い。
APP_ENV: str = os.environ.get("APP_ENV", "development")


def env_file_for(app_env: str) -> Path:
    """`APP_ENV` の値から、読み込む .env ファイルのパスを返す。

    例: "test" → <リポジトリルート>/.env.test
    （純粋関数なのでテストしやすいように切り出している）
    """
    return _REPO_ROOT / f".env.{app_env}"


class Settings(BaseSettings):
    """環境変数から読み込むアプリ設定。

    それぞれの属性が 1 つの環境変数に対応する（大文字小文字は区別しない）。
    デフォルト値が無い属性は、環境変数か .env に無いと起動時にエラーになる。
    """

    # pydantic-settings への指示。
    model_config = SettingsConfigDict(
        # APP_ENV に応じて読み込む .env ファイルを切り替える。
        env_file=env_file_for(APP_ENV),
        env_file_encoding="utf-8",
        case_sensitive=False,
        # .env に未知のキーがあっても無視する（フロント用の変数などが
        # 同じファイルに混ざっていてもエラーにしない）。
        extra="ignore",
    )

    # --- 実行環境 ---------------------------------------------------------
    APP_ENV: Literal["development", "test", "production"] = "development"

    # --- データベース ---------------------------------------------------
    # SQLAlchemy 形式の接続文字列（postgresql+psycopg://...）。
    DATABASE_URL: str

    # --- 認証（JWT）— 実際に使うのは Phase 1（#35）から ----------------
    JWT_SECRET_KEY: str = "dev-only-not-a-real-secret"
    ACCESS_TOKEN_TTL_MINUTES: int = 15
    REFRESH_TOKEN_TTL_DAYS: int = 60

    # --- オブジェクトストレージ（S3 / MinIO）— 使うのは Phase 3（#39） -
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = "recipi-images"
    S3_ACCESS_KEY_ID: str = "changeme"
    S3_SECRET_ACCESS_KEY: str = "changeme"
    S3_PUBLIC_URL_BASE: str = "http://localhost:9000/recipi-images"

    # --- 画像アップロード（#39） ----------------------------------------
    # 一時アップロードの寿命。画像は「レシピ保存より前」にアップロードされる
    # ため、ユーザーが保存せずに離脱すると誰からも参照されない孤児が残る。
    # それを掃除する GC（app/jobs/gc_uploads.py）が「いつ孤児と見なすか」。
    #
    # - PENDING: 行だけ作った直後〜オブジェクト保存完了まで。通信断や
    #   サーバー再起動でここに取り残される。1 リクエスト分あれば足りる。
    # - STORED: 保存済みだがまだレシピに紐付いていない（＝ユーザーが編集中
    #   かもしれない）。短すぎると編集途中で画像が消えて保存時に 400 になる。
    #
    # 環境変数で上書きできるようにしているのは、結合テストで極端に短くして
    # GC の挙動（24 時間待たずに）を検証するため。
    # pending の寿命は PUT にかかる最大時間（app/storage.py のタイムアウト × リトライ、数分）
    # より十分長くすること。アカウント削除の遅延削除がこれを前提にしている（Issue #71）。
    UPLOAD_PENDING_TTL_SECONDS: int = 3600  # 1 時間
    UPLOAD_STORED_TTL_SECONDS: int = 86400  # 24 時間

    # 1 枚あたりの受け入れ上限（features/image.md §6）。
    IMAGE_MAX_BYTES: int = 5 * 1024 * 1024  # 5MiB
    # 保存時に長辺をこのピクセル数まで縮小する（元画像はそのままにしない）。
    # クライアント（#40）でも縮小するが、不正なクライアント対策として
    # サーバー側でも必ず上限に収める。
    #
    # 2048 にしている理由: スマホの標準カメラは 4:3・約 4000x3000（12MP）で
    # 撮る（iPhone 4032x3024 / Pixel 4080x3072 / Galaxy 4000x3000）。
    # これを 4:3 のまま 2048x1536（約 3MP）に収めると、
    # - スマホ全画面（幅 390pt × 3 倍 DPI ≒ 1170px）に対して余裕がある
    # - タブレットやデスクトップの大きい画面でも粗くならない
    # - JPEG で 300〜600KB 程度に収まり、通信量・保存容量も現実的
    IMAGE_MAX_DIMENSION: int = 2048
    # 圧縮率の高い画像はバイト数が 5MiB 未満でも、展開すると大量のピクセルを
    # 占有してメモリを圧迫するため、バイト数とは別に画素数にも上限を設ける。
    IMAGE_MAX_PIXELS: int = 40_000_000

    # --- CORS（フロントからのブラウザ / デスクトップ経由の呼び出しを許可） -
    # Web（Expo）や Tauri はページのオリジン（例 http://localhost:8081）と
    # API のオリジン（http://localhost:8000）が違うため、CORS の許可が要る。
    # カンマ区切りで複数指定。本番はデプロイ先のフロントのオリジンを入れる。
    CORS_ALLOW_ORIGINS: str = (
        "http://localhost:8081,http://localhost:19006,"
        "http://localhost:1420,http://tauri.localhost,tauri://localhost"
    )

    # --- ログ ----------------------------------------------------------
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "text"] = "json"

    # --- AI 校正プロバイダ — 使うのは Phase 11 ------------------------
    AI_PROVIDER: Literal["local", "anthropic", "stub"] = "local"
    ANTHROPIC_API_KEY: str = Field(default="")

    @property
    def is_test(self) -> bool:
        return self.APP_ENV == "test"

    @property
    def cors_allow_origins(self) -> list[str]:
        """CORS_ALLOW_ORIGINS（カンマ区切り文字列）をリストにして返す。"""
        return [o.strip() for o in self.CORS_ALLOW_ORIGINS.split(",") if o.strip()]

    @model_validator(mode="after")
    def _reject_insecure_production_config(self) -> Settings:
        """production では「ダミーのまま」の秘密で起動させない。"""
        if self.APP_ENV != "production":
            return self
        if self.JWT_SECRET_KEY in _INSECURE_JWT_SECRETS or len(self.JWT_SECRET_KEY) < 32:
            raise ValueError(
                "production では JWT_SECRET_KEY に 32 文字以上の本物のランダム鍵を"
                "設定してください（.env.production / シークレット管理で注入）。"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """設定を 1 回だけ生成してキャッシュする。

    `lru_cache` を付けると、2 回目以降の呼び出しは同じインスタンスを返す
    （= .env の読み込みは 1 回だけ）。テストでキャッシュを消したいときは
    `get_settings.cache_clear()` を呼ぶ。
    """
    return Settings()  # 必須項目（DATABASE_URL 等）は環境変数 / .env から入る


# よく使うので、モジュール変数としても公開する。
settings = get_settings()
