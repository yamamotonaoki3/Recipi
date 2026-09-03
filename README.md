# Recipi

手軽にレシピを登録・共有・検索できるアプリ。モバイルファーストで **Android / iOS / デスクトップ（Windows・macOS）** に対応。

- **現在**: 要件定義フェーズ完了 → MVP（Phase 0〜4）を実装中。
- **要件定義書**: [`docs/requirements/`](docs/requirements/)（索引: [`docs/requirements/README.md`](docs/requirements/README.md)）
- **ロードマップ / MVP ライン**: [`docs/requirements/roadmap.md`](docs/requirements/roadmap.md)
- **技術スタック**: バックエンド = Python 3.14 + FastAPI + SQLModel + Alembic ／ フロント = TypeScript + React Native + Expo（必須）＋ Kotlin Multiplatform（随時）。詳細は [`docs/requirements/tech-stack.md`](docs/requirements/tech-stack.md)

## リポジトリ構成（実装が進むと増える）

```text
Recipi/
├── .env.development.example / .env.test.example / .env.production.example   環境変数のテンプレート
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
alembic upgrade head            # DB マイグレーション適用
uvicorn app.main:app --reload   # http://localhost:8000
```

**3. バックエンドのチェック（CI と同じ内容）** — `backend/` で実行

```bash
ruff check .
ruff format --check .
mypy .
pytest                          # 単体 ＋ 結合。pytest 設定が APP_ENV=test を
                                # 強制し .env.test の使い捨て DB を使う
```

**4. フロントエンド（`expoApp/`）** — コマンドは OS 共通

```bash
cd expoApp
npm install
npm run web                     # ブラウザで確認（デスクトップの土台）
npm run tauri dev               # デスクトップアプリとして起動

# チェック（CI と同じ内容）
npm run lint
npm run typecheck
npm test                        # jest（単体・結合。API は MSW でモック）

# E2E（Phase 1 以降・Maestro CLI が必要）
#   インストール: https://maestro.mobile.dev/getting-started/installing-maestro
maestro test .maestro/
```

### テストの方針

- **単体 / 結合 / E2E ＋ 静的解析（品質チェック）＋ 契約テスト**を CI（GitHub Actions）で回す。
- テストは **ブラックボックス（仕様ベース）＋ ホワイトボックス（実装・分岐ベース）** を併用する。
- 詳細: [`docs/requirements/testing.md`](docs/requirements/testing.md)

## 開発ワークフロー

作業は必ず GitHub Issue から。`main` へは直接 push せず PR 経由（[`CLAUDE.md`](CLAUDE.md)）。
