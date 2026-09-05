# 環境変数・シークレットのカタログ

> 全環境変数の一覧と扱い方。**実際の値**は `.gitignore` 対象の `.env.development` / `.env.test` / `.env.production` にのみ置き、**コミットするのはプレースホルダのみの `.env.*.example`**（グローバル `~/.claude/CLAUDE.md`「秘密情報の標準取り扱い要件」／ [architecture.md](architecture.md)「秘密情報の扱い」／ [non-functional.md](non-functional.md)）。
>
> `.env.*.example` ファイル本体は Phase 0 のイシューでこの表どおりに作成する。

## 1. 環境の切り替え（`APP_ENV`）

- `APP_ENV` = `development` / `test` / `production` の 3 つ。
- backend は `APP_ENV` を見て `.env.<APP_ENV>` を読み込む（`backend/app/config.py`、`pydantic-settings`）。
- frontend（Expo）は `EXPO_PUBLIC_*` を `.env` から読む（`development` / `test` を切り替え）。
- テスト実行時は `APP_ENV=test`。**テスト用 DB / ストレージはローカルまたは CI の使い捨てに限定し、本番・ステージングへ接続しない**。
  - **ローカル**: 開発と同じ compose の PostgreSQL コンテナ内の**別データベース** `recipi_test` を使う（`infra/postgres-init/` が初回起動時に作成。所有ロールは `.env.development` と同じ）。`.env.test` の `DATABASE_URL` は user / password を `.env.development` と揃え、DB 名だけ `recipi_test` にする。
  - **CI**: GitHub Actions の `postgres` service（専用ロール / DB）。`backend.yml` が `.env.test` の値を service に合わせて上書きする。
  - pytest の `conftest.py` は、`DATABASE_URL` の DB 名に "test" を含まない場合セッションを中断する（安全網）。

| 環境 | 用途 | DB / ストレージ | AI プロバイダ |
| --- | --- | --- | --- |
| `development` | ローカル開発（Docker Compose） | compose の `postgres` / `minio` | `local`（ローカル推論・Phase 11） |
| `test` | 自動テスト（ローカル・CI） | 使い捨ての Postgres / MinIO | `stub`（決定的ダミー） |
| `production` | 本番（デプロイ先未定・[todo.md](todo.md) #2） | マネージド DB / S3 互換 | `anthropic`（クラウド LLM・Phase 11） |

## 2. 変数一覧

「値の性質」列: **fixed** = どの環境でも同じ定数、**per-env** = 環境ごとに変える、**secret** = 秘密（生成した値。`.env.*` のみ）、**local-only** = ローカル / CI でのみ使う。

### backend（`.env.development` / `.env.test` / `.env.production`）

| 変数 | 用途 | 値の性質 | 例プレースホルダ | 備考 |
| --- | --- | --- | --- | --- |
| `APP_ENV` | 実行環境の選択 | per-env | `development` | `development` / `test` / `production` |
| `DATABASE_URL` | DB 接続文字列 | per-env / secret | `postgresql+psycopg://<user>:<password>@<host>:<port>/<db>` | SQLAlchemy 形式。**組み立てた実際の URL（本物のパスワード・ホストを含む）は `.env.<APP_ENV>`（`.gitignore` 対象）にのみ置く。** `.env.*.example` にはこのテンプレートのまま書く。[tech-stack.md](tech-stack.md) |
| `POSTGRES_DB` | compose の postgres の DB 名 | per-env | `recipi` | compose とアプリで一致させる |
| `POSTGRES_USER` | compose の postgres のユーザー | per-env | `recipi` | `root` / `postgres` のような推測可能値は避ける |
| `POSTGRES_PASSWORD` | compose の postgres のパスワード | secret | `changeme` | 生成した文字列。`password` 等は使わない |
| `JWT_SECRET_KEY` | アクセストークン（JWT）の署名鍵 | secret | `changeme-generate-a-long-random-string` | 十分な長さのランダム値。[features/auth.md](features/auth.md) |
| `ACCESS_TOKEN_TTL_MINUTES` | アクセストークンの有効期限 | fixed（目安） | `15` | 短命（[non-functional.md](non-functional.md)） |
| `REFRESH_TOKEN_TTL_DAYS` | リフレッシュトークンの有効期限 | fixed（目安） | `60` | 保持 ON / OFF での差は [todo.md](todo.md) #16 |
| `S3_ENDPOINT_URL` | オブジェクトストレージのエンドポイント | per-env | `http://localhost:9000` | dev/test は MinIO、prod は S3 互換（[features/image.md](features/image.md)） |
| `S3_REGION` | リージョン | per-env | `us-east-1` | MinIO は任意値でよい |
| `S3_BUCKET` | バケット名 | per-env | `recipi-images` | |
| `S3_ACCESS_KEY_ID` | ストレージのアクセスキー | secret | `changeme` | dev/test は MinIO のルート資格情報と一致 |
| `S3_SECRET_ACCESS_KEY` | ストレージのシークレットキー | secret | `changeme` | |
| `S3_PUBLIC_URL_BASE` | 表示用 URL の基底（公開バケット時） | per-env | `http://localhost:9000/recipi-images` | 署名付き URL 方式なら未使用（[features/image.md](features/image.md)） |
| `MINIO_ROOT_USER` | compose の MinIO のルートユーザー | secret / local-only | `changeme` | `S3_ACCESS_KEY_ID` と一致させる。`.env.production` には**書かない** |
| `MINIO_ROOT_PASSWORD` | compose の MinIO のルートパスワード | secret / local-only | `changeme` | `S3_SECRET_ACCESS_KEY` と一致させる |
| `CORS_ALLOW_ORIGINS` | Web / Tauri からの API 呼び出しを許可するオリジン（カンマ区切り） | per-env | `http://localhost:8081,http://tauri.localhost,tauri://localhost` | 本番はデプロイ先フロントのオリジン。Issue #34 |
| `LOG_LEVEL` | ログレベル | per-env | `INFO` | dev は `DEBUG` 可 |
| `LOG_FORMAT` | ログ形式 | per-env | `json` | 本番は `json`（構造化ログ・[non-functional.md](non-functional.md) / [todo.md](todo.md) #44） |
| `AI_PROVIDER` | AI 校正プロバイダの選択（**Phase 11**） | per-env | `local`（dev）/ `stub`（test）/ `anthropic`（prod） | 契約はプロバイダ非依存（[features/ai-proofread.md](features/ai-proofread.md)） |
| `ANTHROPIC_API_KEY` | Anthropic API キー（**Phase 11・production のみ**） | secret | （`.env.production.example` では空） | 本番のシークレット管理で注入。dev/test では未設定 |

### frontend-ts（`expoApp/.env` — `EXPO_PUBLIC_` 接頭辞のみクライアントに露出）

| 変数 | 用途 | 値の性質 | 例プレースホルダ | 備考 |
| --- | --- | --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | バックエンド API の**ホストまで**（例: `http://localhost:8000`。`/api/v1` などのパスは付けない） | per-env | `http://localhost:8000` | Android エミュレータからは `http://10.0.2.2:8000`、実機は LAN IP。**秘密は入れない**（クライアントに埋め込まれる） |

> フロントには**秘密情報を置かない**。`EXPO_PUBLIC_` が付いた変数はビルド成果物に埋め込まれ、誰でも読める。
>
> **Expo は `expoApp/` ディレクトリから `.env` を読む**（リポジトリルートではない）。そのため frontend-ts の環境変数は `expoApp/.env.development` 等に置き、テンプレートも `expoApp/.env.*.example` として `expoApp` 側に置く（`expoApp/` に作成済み。Issue #34）。

## 3. `.env.*.example` に書く内容

### リポジトリルート（backend / infra 用・3 ファイル）

- **`.env.development.example`**: 上表 backend の development 相当のプレースホルダ。`APP_ENV=development` / `AI_PROVIDER=local` / MinIO のルート資格情報あり。
- **`.env.test.example`**: `APP_ENV=test` / `AI_PROVIDER=stub` / テスト用 DB・ストレージのプレースホルダ。
- **`.env.production.example`**: `APP_ENV=production` / `AI_PROVIDER=anthropic` / `ANTHROPIC_API_KEY=`（空）。`MINIO_ROOT_*` は書かない（本番は S3 互換のマネージドを想定）。

### `expoApp/`（frontend-ts 用・作成済み）

- `expoApp/.env.development.example` / `.env.test.example` / `.env.production.example` に `EXPO_PUBLIC_API_BASE_URL` のプレースホルダ。`.env` の実体は `expoApp/.gitignore` で除外する。

すべて**プレースホルダのみ**（`changeme` 等）。`root` / `password` / `admin` のような推測可能値は使わない。辞書に載る単語を避け、必要な箇所は生成した文字列を使う。

- **接続文字列（`DATABASE_URL` 等）は「本物の値を埋め込んだ形」で `.example` に書かない**。`postgresql+psycopg://<user>:<password>@<host>:<port>/<db>` のようなテンプレート、または各要素を別の環境変数（`POSTGRES_USER` 等）に分けて書き、実行時に組み立てる。組み立て済みの実 URL は `.env.<APP_ENV>`（`.gitignore` 対象）にのみ存在する。
- この `environment.md` を含め、**コミットされるファイルに実際の認証情報を含む URL を載せない**（グローバル `~/.claude/CLAUDE.md`「秘密情報の標準取り扱い要件」）。

## 4. `docker-compose.yml` での参照

- コミットする `infra/docker-compose.yml` は**環境変数展開のみ**（`${POSTGRES_PASSWORD}` など）。実値を埋め込まない。
- `${...}` 展開のための値は **`--env-file` で明示的に渡す**（compose は `.env.development` を自動では読まず、既定は `.env` のみ）:
  - `docker compose --env-file .env.development -f infra/docker-compose.yml up -d postgres minio`
- 加えて各サービスの `env_file:` でコンテナ内のランタイム環境変数として渡す（`${...}` 展開とは別の役割）。**`env_file:` のパスは compose ファイルからの相対**なので、`infra/docker-compose.yml` では `env_file: ../.env.development` と書く（リポジトリルートの `.env.development` を指す）。
- **ホスト名は「誰が接続するか」で分ける**（3 系統）:
  - **バックエンド → DB / ストレージ**（サーバー内部の接続。`DATABASE_URL` / `S3_ENDPOINT_URL`）: ホストで uvicorn なら `localhost`、compose の `api` サービスなら `postgres` / `minio`（`api` サービスの `environment:` で上書き）。
  - **クライアント → バックエンド / 画像**（`EXPO_PUBLIC_API_BASE_URL` / `S3_PUBLIC_URL_BASE`。API が返す画像 URL もこれで組み立てる）: 開発マシンをどう指すかに合わせる。Web / デスクトップ / iOS シミュレータは `localhost`、**Android エミュレータは `10.0.2.2`、実機は開発マシンの LAN IP**。`EXPO_PUBLIC_API_BASE_URL` と `S3_PUBLIC_URL_BASE` は**必ず同じホスト表記に揃える**。
  - Android エミュレータでの E2E など、`localhost` が使えない実行では両方を `10.0.2.2` にした `.env` を用意する。
- **標準の開発フロー**: compose は `postgres` / `minio` だけ起動し、バックエンドは `uvicorn --reload` でホスト実行（高速な反復のため）。`api` サービスはフルスタック実行・E2E 用。

## 5. CI（GitHub Actions）でのテスト用の値

- CI では `.env.test` を**ワークフロー内で生成**する（`.env.test.example` をコピーし、必要な値を埋める）。
- 秘密でない値（DB 名・ユーザー名・ダミーの鍵）はワークフローに直書きでよい。**本物の秘密は GitHub Actions の Secrets** から注入する（MVP 段階では本物の秘密を要するテストは無い想定 = `AI_PROVIDER=stub`）。
- テスト DB / MinIO は `services:` / コンテナで都度立て、ジョブ終了で破棄する（[testing.md](testing.md) §5）。

## 6. テストデータ規約（再掲）

[non-functional.md](non-functional.md) 「テストデータ規約」／ グローバル `~/.claude/CLAUDE.md` に従う。

- メール: `@example.com` / `@example.org` / `@example.net` のみ。
- ユーザー名: `testuser_%` / `e2euser_%` 接頭辞。本文タグ: `[E2E_TEST]` 等。
- パスワード: `TestPass123!` のようなテスト専用固定値。
- 識別子ベースで一括削除する `cleanup` を用意し、テスト後に残数 0 を確認。
- **本番・ステージング DB に接続しうる設定でテストを実行しない。**

## 7. `.gitignore`

既に `.env` / `.env.*` を除外し `!.env.*.example` を例外にしている。Phase 0 で `backend/.venv/` / `expoApp/.expo/` / `**/coverage/` / `.pytest_cache/` を追加する。
