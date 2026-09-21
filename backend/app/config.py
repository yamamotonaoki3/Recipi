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

import ipaddress
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

# production で使ってはいけない、ログ用ハッシュ鍵（LOG_HASH_SECRET）のダミー値。
# 鍵が知られると、ログの email_hash から元のメールアドレスを総当たりで割り出せる。
_INSECURE_LOG_HASH_SECRETS = {"", "dev-only-log-hash-secret", "changeme"}

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
    APP_ENV: Literal["development", "demo", "test", "production"] = "development"

    # --- データベース ---------------------------------------------------
    # SQLAlchemy 形式の接続文字列（postgresql+psycopg://...）。
    DATABASE_URL: str

    # 接続プールの設定（Issue #191。app/db.py の create_engine に渡す）。
    #
    # これまで指定しておらず、SQLAlchemy の既定（5 ＋ 予備 10 ＝ 15 接続・
    # 待ち上限 30 秒）のまま動いていた。API のエンドポイントはすべて同期関数
    # （`def`）なので Starlette のスレッドプール（既定 40）で実行され、
    # 40 スレッドが 15 本の接続を奪い合って 30 秒待ち、QueuePool のタイムアウトで
    # 500 になっていた（性能テストのスパイクで実測。Issue #189）。
    #
    # 数を増やすこと自体が目的ではない。20 本にしても 100 VU 分の同時要求は
    # 捌けないので、**溢れた分を待たせずに 503 で返す**（app/main.py のハンドラ）
    # ほうが本質的な対策になる。
    #
    # 常時保持する接続の本数。
    DB_POOL_SIZE: int = Field(default=10, ge=1)
    # 急増したときに一時的に追加してよい本数（合計 = POOL_SIZE + MAX_OVERFLOW）。
    # 本番は RDS db.t4g.micro（max_connections 約 110）に対して 1 タスク 20 本。
    # 定期ジョブ・マイグレーション・手動接続の分を残せる範囲にしている。
    DB_MAX_OVERFLOW: int = Field(default=10, ge=0)
    # 接続が空くのを待つ上限（秒）。既定の 30 秒から短くしている。
    # 5 秒待って空かないなら、その先も詰まっている可能性が高い。長く待たせるほど
    # スレッドが占有され、クライアントから見ると「応答が返ってこない」に等しくなる。
    DB_POOL_TIMEOUT_SECONDS: float = Field(default=5.0, gt=0)

    # --- 認証（JWT）— 実際に使うのは Phase 1（#35）から ----------------
    JWT_SECRET_KEY: str = "dev-only-not-a-real-secret"
    ACCESS_TOKEN_TTL_MINUTES: int = 15
    REFRESH_TOKEN_TTL_DAYS: int = 60
    # WebブラウザのHttpOnly Cookie認証設定。
    AUTH_COOKIE_NAME: str = "recipi_refresh_token"
    AUTH_COOKIE_SECURE: bool = False
    AUTH_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    AUTH_COOKIE_PATH: str = "/api/v1/auth"

    # --- オブジェクトストレージ（S3 / MinIO）— 使うのは Phase 3（#39） -
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = "recipi-images"
    S3_ACCESS_KEY_ID: str = "changeme"
    S3_SECRET_ACCESS_KEY: str = "changeme"
    S3_PUBLIC_URL_BASE: str = "http://localhost:9000/recipi-images"
    # 本番（AWS）では S3_ENDPOINT_URL・S3_ACCESS_KEY_ID・S3_SECRET_ACCESS_KEY を空にする。
    # 空なら AWS の標準エンドポイントと、ECS のタスクロールの認証情報を使う
    # （app/storage.py の _client_kwargs。Issue #166）。

    # --- クライアント IP の取得（Issue #166） ------------------------------
    # API Gateway（VPC Link）の接続元として信頼する範囲（カンマ区切りの CIDR）。
    # この範囲から来たリクエストだけ、API Gateway が付けた専用ヘッダー
    # （X-Recipi-Client-Ip。app/request_utils.py）をクライアントの IP として使う。
    # 本番は VPC Link の ENI が置かれる private サブネットの CIDR（Terraform が渡す）。
    # 開発・テストは空（常に接続元の IP を使う）。
    TRUSTED_PROXY_CIDRS: str = ""

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
    IMAGE_MAX_DIMENSION: int = Field(default=2048, ge=1)
    # 圧縮率の高い画像はバイト数が 5MiB 未満でも、展開すると大量のピクセルを
    # 占有してメモリを圧迫するため、バイト数とは別に画素数にも上限を設ける。
    IMAGE_MAX_PIXELS: int = 40_000_000

    # `private/` の画像を表示するための署名付き URL の有効期限（Issue #185）。
    #
    # **暫定値**。次の 2 つに挟まれた範囲で決めている:
    # - 下限: フロントがレスポンスをキャッシュする時間より十分長いこと
    #   （TanStack Query の staleTime は既定 30 秒・レシピ系は 10 分）。
    #   短すぎると、画面に出したままの画像だけが切れる。
    # - 上限: 署名に使う認証情報の寿命。本番は ECS のタスクロール（一時認証情報）
    #   で署名するため、セッションが失効すると残り時間に関わらず URL も無効になる。
    #
    # 実環境での認証情報の寿命は未検証（本番をまだ apply していないため）。
    # Issue #184 で確認し、必要ならこの値を調整する（環境変数で変えられる）。
    #
    # なお、画面を有効期限より長く開いたままにすると、描画済みの URL が失効して
    # 画像だけが表示できなくなる。**期限切れを検知して取り直すのはフロント側の
    # 責務**で、Issue #186 で対応する。
    # AWS SigV4 の署名付き URL の有効期限は最大 7 日（604800 秒）。
    # ただし本番では ECS のタスクロールの一時認証情報の寿命がこれより短いため、
    # 実効上の有効期限はさらに短くなる。
    IMAGE_URL_TTL_SECONDS: int = Field(default=3600, ge=1, le=604800)  # 1 時間

    # --- 定期ジョブの保持期間・上限（Issue #72。processing-model.md §8） -------
    # 「消してよい古さ」を決める値。どれも 1 以上（0 や負の値だと、まだ必要な
    # 行まで消してしまうので、起動時に設定エラーにする）。
    #
    # 既読になってからこの日数を過ぎた通知を消す（未読は消さない）。
    NOTIFICATION_READ_RETENTION_DAYS: int = Field(default=90, ge=1)
    # 配り終えてからこの日数を過ぎた通知 outbox の行を消す（未処理は消さない）。
    OUTBOX_PROCESSED_RETENTION_DAYS: int = Field(default=7, ge=1)
    # リフレッシュトークンのチェーンが、最後のトークンの期限切れからこの日数を
    # 過ぎたら消す（それまでは古いトークンの再利用を検知できるよう残す）。
    REFRESH_TOKEN_EXPIRED_RETENTION_DAYS: int = Field(default=30, ge=1)
    # 閲覧履歴を 1 ユーザーあたりこの件数まで残す（超えた分は古い順に消す）。
    RECIPE_VIEWS_MAX_PER_USER: int = Field(default=200, ge=1)
    # パスワード再設定の試行記録（メール・IP を含む）を、作られてからこの日数で消す（Issue #85）。
    # レート制限が数えるのは直近 15 分だけなので、1 日あれば判定に必要な記録は残る。
    PASSWORD_RESET_ATTEMPT_RETENTION_DAYS: int = Field(default=1, ge=1)
    # 再認証（現パスワードの確認）の試行記録を、作られてからこの日数で消す（Issue #240）。
    # 理由は上と同じ。レート制限が見るのは直近 15 分だけ。
    REAUTH_ATTEMPT_RETENTION_DAYS: int = Field(default=1, ge=1)

    # --- CORS（フロントからのブラウザ / デスクトップ経由の呼び出しを許可） -
    # Web（Expo）や Tauri はページのオリジン（例 http://localhost:8081）と
    # API のオリジン（http://localhost:8000）が違うため、CORS の許可が要る。
    # カンマ区切りで複数指定。本番はデプロイ先のフロントのオリジンを入れる。
    CORS_ALLOW_ORIGINS: str = (
        "http://localhost:8081,http://localhost:19006,"
        "http://localhost:1420,http://tauri.localhost,tauri://localhost"
    )
    CORS_ALLOW_CREDENTIALS: bool = True

    # --- ログ ----------------------------------------------------------
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "text"] = "json"
    # 監査ログでメールアドレスを平文の代わりに出す email_hash（HMAC）の鍵（Issue #170）。
    # production では 32 文字以上の本物のランダム鍵が必須（下の検証）。
    LOG_HASH_SECRET: str = "dev-only-log-hash-secret"

    # --- AI 校正プロバイダ — 使うのは Phase 11 ------------------------
    AI_PROVIDER: Literal["local", "anthropic", "stub"] = "local"
    ANTHROPIC_API_KEY: str = Field(default="")
    ANTHROPIC_MODEL: str = "claude-haiku-4-5-20251001"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    # Qwen 3.5 9B。Ollamaの配布版はGPUで動かす量子化モデル（約6.6GB）。
    OLLAMA_MODEL: str = "qwen3.5:9b"
    # Ollama がモデルをメモリから退避するまでの時間。Ollama 0.34系では -1m が
    # 無期限常駐を表す（単位なしの -1 は API が 400 にする）。
    # development の起動時ウォームアップと通常の校正リクエストの両方で使う。
    OLLAMA_KEEP_ALIVE: str = "-1m"
    # 起動時のモデル読み込みだけは通常の校正より余裕を持たせる。失敗しても API は起動し、
    # 校正リクエスト時に AI_UNAVAILABLE (503) を返す。
    OLLAMA_WARMUP_TIMEOUT_SECONDS: float = Field(default=60.0, gt=0, le=120)
    AI_PROVIDER_TIMEOUT_SECONDS: float = Field(default=15.0, gt=0, le=60)
    AI_HOURLY_LIMIT: int = Field(default=20, ge=1)
    AI_DAILY_LIMIT: int = Field(default=100, ge=1)

    @property
    def is_test(self) -> bool:
        return self.APP_ENV == "test"

    @property
    def cors_allow_origins(self) -> list[str]:
        """CORS_ALLOW_ORIGINS（カンマ区切り文字列）をリストにして返す。"""
        return [o.strip() for o in self.CORS_ALLOW_ORIGINS.split(",") if o.strip()]

    @property
    def trusted_proxy_networks(self) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
        """TRUSTED_PROXY_CIDRS（カンマ区切り）を IP のネットワークのリストにして返す。"""
        return [
            ipaddress.ip_network(cidr.strip(), strict=False)
            for cidr in self.TRUSTED_PROXY_CIDRS.split(",")
            if cidr.strip()
        ]

    @model_validator(mode="after")
    def _validate_trusted_proxy_cidrs(self) -> Settings:
        """TRUSTED_PROXY_CIDRS の書き間違いは、起動時にエラーにする（どの環境でも）。"""
        try:
            self.trusted_proxy_networks  # noqa: B018 — 解釈できるかだけを確かめる
        except ValueError as exc:
            raise ValueError(
                f"TRUSTED_PROXY_CIDRS に CIDR として解釈できない値があります: {exc}"
            ) from exc
        return self

    @model_validator(mode="after")
    def _reject_insecure_production_config(self) -> Settings:
        """production では「ダミーのまま」の秘密や、足りない設定で起動させない。"""
        if self.APP_ENV != "production":
            return self
        if self.JWT_SECRET_KEY in _INSECURE_JWT_SECRETS or len(self.JWT_SECRET_KEY) < 32:
            raise ValueError(
                "production では JWT_SECRET_KEY に 32 文字以上の本物のランダム鍵を"
                "設定してください（.env.production / シークレット管理で注入）。"
            )
        if self.LOG_HASH_SECRET in _INSECURE_LOG_HASH_SECRETS or len(self.LOG_HASH_SECRET) < 32:
            raise ValueError(
                "production では LOG_HASH_SECRET に 32 文字以上の本物のランダム鍵を"
                "設定してください（.env.production / シークレット管理で注入）。"
            )
        if not self.AUTH_COOKIE_SECURE:
            raise ValueError("production では AUTH_COOKIE_SECURE=true を設定してください")
        # 画像の保存・配信とクライアント IP に必要な値（Issue #166）。空のリージョンを
        # boto3 に渡すと保存に失敗し、TRUSTED_PROXY_CIDRS が空だと全リクエストが
        # VPC Link の IP 扱いになる（レート制限・監査ログが正しく動かない）。
        for name in ("S3_REGION", "S3_BUCKET", "S3_PUBLIC_URL_BASE", "TRUSTED_PROXY_CIDRS"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"production では {name} を設定してください")
        if not self.S3_PUBLIC_URL_BASE.startswith("https://"):
            raise ValueError(
                "production では S3_PUBLIC_URL_BASE を https:// で始まる URL にしてください"
            )
        if bool(self.S3_ACCESS_KEY_ID.strip()) != bool(self.S3_SECRET_ACCESS_KEY.strip()):
            raise ValueError(
                "S3_ACCESS_KEY_ID と S3_SECRET_ACCESS_KEY は、"
                "両方を設定するか両方を空にしてください（本番は両方空にしてタスクロールを使う）"
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
