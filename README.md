# Recipi

手軽にレシピを登録・共有・検索できるアプリ。モバイルファーストで **Android / iOS / デスクトップ（Windows・macOS）** に対応。

- **現在**: 要件定義フェーズ完了 → MVP（Phase 0〜4）を実装中。
- **要件定義書**: [`docs/requirements/`](docs/requirements/)（索引: [`docs/requirements/README.md`](docs/requirements/README.md)）
- **ロードマップ / MVP ライン**: [`docs/requirements/roadmap.md`](docs/requirements/roadmap.md)
- **技術スタック**: バックエンド = Python 3.14 + FastAPI + SQLModel + Alembic ／ フロント = TypeScript + React Native + Expo（必須）＋ Kotlin Multiplatform（随時）。詳細は [`docs/requirements/tech-stack.md`](docs/requirements/tech-stack.md)

## リポジトリ構成（実装が進むと増える）

```text
Recipi/
├── .env.development.example / .env.demo.example / .env.test.example / .env.production.example   環境変数のテンプレート
├── .github/workflows/   CI（backend / frontend-ts / contract / e2e）
├── backend/             Python バックエンド（FastAPI）        ← Phase 0 で追加
├── expoApp/             TypeScript フロント（Expo / RN）      ← Phase 0 で追加
├── infra/docker-compose.yml   api + postgres + minio          ← Phase 0 で追加
└── docs/requirements/   要件定義書
```

## 環境変数のセットアップ

実際の値は `.env.<環境>`（`.gitignore` 対象・コミットされない）にだけ置く。テンプレート（`.env.*.example`）にはプレースホルダしか書かない。全変数の意味は [`docs/requirements/environment.md`](docs/requirements/environment.md)。

```bash
# 開発用（アプリを動かす）
cp .env.development.example .env.development
#  → .env.development を開いて changeme / <...> を自分の値に置き換える
#     （パスワードは生成した文字列を使う。root / password / admin は使わない）

# テスト用（自動テストを回す。開発用とは別の使い捨て DB を指す）
cp .env.test.example .env.test
#  → .env.test も同様に埋める。DB 名は recipi_test など開発用と分ける
```

> フロントエンド（`expoApp/`）の環境変数は `expoApp/.env.development` に置く（Expo は `expoApp/` から読むため）。テンプレートは Issue #34 で `expoApp/.env.*.example` として追加される。

## README 用デモ環境

既存の開発データを削除せずに、専用DB `recipi_demo` へサンプルを投入する手順です。デモ seed は `APP_ENV=demo` **かつ** DB名に `demo` を含む接続先でしか実行できません。

用意される内容は、3ユーザー・3件の公開レシピ・生成したレシピ画像・材料・手順・フォロー・お気に入り・感想・通知・閲覧履歴です。画像はリポジトリ同梱の生成画像であり、外部サイトからの取得物は含みません。

```powershell
# 1. 開発用の実際の資格情報を保ったまま、デモ用ファイルを作る。
Copy-Item .env.development .env.demo
# .env.demo を開き、APP_ENV=demo と DATABASE_URL の末尾を /recipi_demo に変更する。

# 2. DB / MinIO を起動する。
docker compose --env-file .env.demo -f infra/docker-compose.yml up -d postgres minio

# 3. デモ用DBへマイグレーションとデータ投入を行う。
cd backend
$env:APP_ENV = "demo"
alembic upgrade head
python -m scripts.seed_demo

# 4. バックエンドをデモ設定で起動する。
uvicorn app.main:app --reload
```

> 既に PostgreSQL の Docker ボリュームを作成済みの場合、`infra/postgres-init/02-create-demo-db.sql` は自動実行されません。その場合は `docker compose --env-file .env.demo -f infra/docker-compose.yml exec postgres createdb -U <POSTGRES_USER> recipi_demo` を1回だけ実行してから手順3へ進んでください。

フロントエンドは通常どおり `expoApp/.env.development` の API URL を使って起動します。Webの場合は `http://localhost:8000` を指していることを確認してください。

| 表示名 | メールアドレス | パスワード |
| --- | --- | --- |
| デモ料理人 あかり | `demo.chef@example.com` | `DemoPass123!` |
| デモ食べ歩き みなと | `demo.foodie@example.com` | `DemoPass123!` |
| デモ初心者 ひなた | `demo.beginner@example.com` | `DemoPass123!` |

同じ seed を再実行しても、デモ料理人 あかりのアカウントが存在する場合は変更せず終了します。デモデータを作り直す必要がある場合も、開発DBではなく `recipi_demo` のみを対象にしてください。

## ローカルで動かす・テストする（Phase 0 以降）

> `backend/` と `expoApp/` は Phase 0 で追加される。それまでは要件定義書のみ。

**1. インフラ（DB・ストレージ）だけ起動**（バックエンドはホストで動かす。`api` サービスはフルスタック実行・E2E 用）

```bash
docker compose --env-file .env.development -f infra/docker-compose.yml up -d postgres minio
```

**2. バックエンド（`backend/`）をホストで起動**（`.env.development` の `<host>` は `localhost`）

```bash
cd backend

# 仮想環境の作成と有効化
python -m venv .venv
# macOS / Linux:
source .venv/bin/activate
# Windows PowerShell:
#   .\.venv\Scripts\Activate.ps1

pip install -r requirements.txt -r requirements-dev.txt
# development では起動時に alembic upgrade head を自動実行する
uvicorn app.main:app --reload   # http://localhost:8000
```

**3. バックエンドのチェック（CI と同じ内容）** — `backend/` で実行

```bash
ruff check .
ruff format --check .
mypy .
pytest --cov-report=json        # 単体 ＋ 結合。pytest 設定が APP_ENV=test を
                                # 強制し .env.test の使い捨て DB を使う
python -m scripts.check_coverage coverage.json --lines 85 --branches 75
                                # 行・分岐カバレッジの下限（testing.md §3）
```

**4. フロントエンド（`expoApp/`）** — コマンドは OS 共通

```bash
cd expoApp
npm install
npm run web                     # ブラウザで確認（デスクトップの土台）
npm run tauri dev               # デスクトップアプリとして起動

# チェック（CI と同じ内容）
npm run lint
npm run format                  # Prettier（--check）
npm run typecheck
npm test -- --coverage          # jest（単体・結合。API は MSW でモック）。
                                # --coverage を付けると行・分岐の下限も判定する

# E2E（バックエンド一式を compose で起動してから）
npm run e2e:web                 # Web（Playwright）
npm run e2e:android             # Android（Appium + WebdriverIO。Appium サーバーとエミュレータが必要）
```

**5. デスクトップ（Windows）の未署名 `.msi` を作る**（デモ用。コード署名・ストア配布は対象外。Issue #136）

前提: Rust の stable（Windows は MSVC 版。`rustup show` で `x86_64-pc-windows-msvc`）と、Visual Studio の C++ ビルドツール。WebView2 ランタイム（Windows 10/11 には同梱）。`.msi` を作るための WiX は、初回のビルドで Tauri が自動でダウンロードする（失敗したらビルドのログでネットワーク等を確かめる）。

API の接続先はビルド時にアプリへ埋め込まれる（`EXPO_PUBLIC_API_BASE_URL`。未指定なら `http://localhost:8000`）。先に 2. の手順でバックエンドを `http://localhost:8000` で動かしておく。

```powershell
# Windows PowerShell（expoApp/ で実行）
$env:EXPO_PUBLIC_API_BASE_URL = "http://localhost:8000"
npx tauri build --bundles msi   # Web ビルド（expo export）→ Rust のビルド → .msi
```

```bash
# bash（Git Bash など。expoApp/ で実行）
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000 npx tauri build --bundles msi
```

- できるもの: `src-tauri/target/release/bundle/msi/Recipi_0.1.0_x64_en-US.msi`（インストーラー）と `src-tauri/target/release/app.exe`（インストールせずに直接起動できる本体）。作るのは `.msi` だけ（`--bundles msi`。macOS の `.dmg` はこの手順の対象外）
- インストールせずに試すときは、`src-tauri/target/release/app.exe` をその場で起動する（単体で別の場所へコピーしない）
- ログイン情報（リフレッシュトークン）は Stronghold の `%APPDATA%\com.recipi.app\recipi-vault.hold` に保存される。「ログインを保持」ON なら、閉じて開き直してもログインしたまま
- 未署名なので、配布先の Windows の設定・評価状況によって SmartScreen の警告が出ることがある
- GitHub Actions の手動ワークフロー `tauri`（「Run workflow」）でも、Windows で `.msi` を作って artifact `recipi-msi` に保存できる（ローカルの api 向けのデモ用）

### テストの方針

- **単体 / 結合 / Web E2E ＋ 静的解析（品質チェック）＋ 契約テスト**を通常の CI（GitHub Actions）で回す。
- 実行時間の長い Android E2E と Tauri 検証は、Phase 完了時・リリース前・関連する共通基盤の変更時に GitHub Actions から手動実行する。
- テストは **ブラックボックス（仕様ベース）＋ ホワイトボックス（実装・分岐ベース）** を併用する。
- 詳細: [`docs/requirements/testing.md`](docs/requirements/testing.md)

## 本番環境（AWS）

本番は **AWS**（ap-northeast-1）で、構成は Terraform（[`infra/terraform/`](infra/terraform/)）で管理しています。公開の入口は API Gateway HTTP API で、VPC Link ＋ Cloud Map 経由で private サブネットの ECS Fargate に届きます。DB は RDS PostgreSQL 18、画像は非公開の S3 ＋ CloudFront（OAC）配信、ログとアラームは CloudWatch ＋ SNS（メール）、定期ジョブは EventBridge Scheduler が ECS タスクとして動かします。backend のデプロイは GitHub Actions の手動ワークフロー（OIDC）で行い、main への push で自動デプロイはしません。

学習用のため常時稼働させず、**確認するときだけ `terraform apply` して、終わったら `terraform destroy`** する運用です。はじめて立てるときの通し手順（state 用バケット → ECR → イメージの push → apply → マイグレーション → GitHub Secrets → destroy）と費用の目安は [`infra/terraform/README.md`](infra/terraform/README.md)、設計の全体像とトレードオフは [`docs/requirements/architecture.md`](docs/requirements/architecture.md) の「本番デプロイ」にあります。

## 開発ワークフロー

作業は必ず GitHub Issue から。`main` へは直接 push せず PR 経由（[`CLAUDE.md`](CLAUDE.md)）。
