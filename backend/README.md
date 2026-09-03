# backend（Recipi API）

FastAPI + SQLModel + Alembic の Python バックエンド。要件定義書は
[`../docs/requirements/`](../docs/requirements/)。

## コードの読み方（`app/` の主要ファイル）

| ファイル | 役割 |
| --- | --- |
| `app/main.py` | FastAPI アプリの入口。`uvicorn app.main:app` の `app`。ヘルスチェックだけ実装済み |
| `app/config.py` | 環境変数 / `.env.<APP_ENV>` から設定を読む（`pydantic-settings`）。`settings` を他モジュールが import する |
| `app/db.py` | DB エンジンとセッション（`get_session` 依存性）。`check_db_connection()` は疎通確認 |
| `app/logging_config.py` | JSON ログの設定。`request_id`（ContextVar）を各ログに付ける |
| `app/middleware.py` | リクエストごとに `X-Request-ID` を採番して ContextVar にセットするミドルウェア |
| `alembic/` | DB マイグレーション。`env.py` が接続先を `app.config` から取る。`versions/` に各リビジョン |
| `tests/` | pytest。`conftest.py` が `APP_ENV=test` を強制。`@pytest.mark.integration` は実 DB が要る |
| `scripts/export_openapi.py` | `openapi/openapi.json` を書き出す（契約テスト用） |

Phase 1 以降、`app/models/`（SQLModel テーブル）、`app/api/`（ルーター）、
`app/services/`（業務ロジック）などを足していく。

## セットアップ

前提: Python 3.14.7、Docker（[`../README.md`](../README.md) 参照）。

```bash
# 1. リポジトリルートで .env を用意
cd ..
cp .env.development.example .env.development
#   → changeme / <...> を自分の値に置き換える（パスワードは生成した文字列）
cp .env.test.example .env.test
#   → user / password は .env.development と同じにし、DB 名だけ recipi_test にする
#     （テスト DB は同じ postgres コンテナ内の別 DB。所有者は開発と同じロール）

# 2. インフラ（DB・ストレージ）を起動（初回起動時に recipi_test DB も作られる）
docker compose --env-file .env.development -f infra/docker-compose.yml up -d postgres minio

# 3. backend の仮想環境
cd backend
python -m venv .venv
source .venv/bin/activate                     # Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

# 4. マイグレーション適用（開発 DB）
alembic upgrade head

# 5. 起動
uvicorn app.main:app --reload                 # http://localhost:8000/docs
```

## よく使うコマンド

```bash
# 品質チェック（CI と同じ。&& で繋がず 1 行ずつ）
ruff check .
ruff format --check .          # 自動整形は `ruff format .`
mypy .

# テスト（conftest が APP_ENV=test を強制する）
pytest                         # 単体 ＋ 結合（結合は要 Docker）
pytest -m "not integration"    # Docker が無いとき（DB を使うテストを除外）

# API 契約（openapi.json をコードから作り直す）
python -m scripts.export_openapi

# マイグレーション
alembic revision -m "add xxx table"   # 新規リビジョンの雛形を作る（→ 手で編集）
alembic upgrade head                  # 最新まで適用
alembic downgrade -1                  # 1 つ戻す
```

## マイグレーションの方針（[`../docs/requirements/data-model.md`](../docs/requirements/data-model.md) / [todo.md](../docs/requirements/todo.md) #43）

- `alembic revision --autogenerate` で下書きを作ってよいが、**DB レベルの制約が正**。
  複合外部キー・部分インデックス・`CHECK`・トリガーは autogenerate では出ないので
  **手書きで補い、生成物は必ず人がレビュー**してからコミットする。
- シードデータ（`units` の初期値など）もマイグレーションで投入する。

## 依存とバージョン

`requirements.txt`（実行時）/ `requirements-dev.txt`（開発・テスト）で `==` 固定。
検証環境: Python 3.14.7 / Windows（2026-09-04）。更新は venv で入れ直して
動作確認してからファイルを書き換える。
