# Recipi

レシピを登録・共有・検索できる、モバイルファーストのレシピアプリです。認証、レシピと画像の管理、検索、フォロー、お気に入り、感想、通知、AIによる誤字脱字チェックを実装しています。

公開URLのデモは用意していません。代わりに、Docker Desktop があれば第三者も自分のPC上でデモデータ入りの環境を起動できます。

## 主な機能

- メールアドレス認証、ログイン保持、パスワードリセット、プロフィール編集・退会
- アカウント設定（現在のパスワードで再認証してからのメールアドレス変更・秘密の質問の変更）
- レシピの作成・編集・削除、材料グループ、手順ごとの画像、下書きの離脱防止
- 公開レシピのフィード、タイトル・材料名検索、閲覧履歴
- ユーザーのフォロー / フォロワー、お気に入り、感想、アプリ内通知
- レシピ編集時のAI誤字脱字チェック（候補を確認してから個別・一括で適用）
- 期限付きURLによるレシピ画像配信、Dockerコンテナのスモークテスト、GitHub Actions CI

機能ごとの仕様と受け入れ基準は [`docs/requirements/features/`](docs/requirements/features/) にまとめています。

## 対応プラットフォーム

Android / デスクトップ（Windows・macOS）に対応しています。**iOS はこの学習プロジェクトでは対象外**です。Windows 環境では Xcode/Mac が無く iOS のネイティブアプリをローカルビルドできません。EAS Build のクラウドビルドで、Apple Developer Program への加入なしで作れるのはシミュレータ向けビルドまで（シミュレータの実行自体には Mac/Xcode が必要）で、自分の端末の実機で試すにはMac上のローカルXcodeビルド（無料だがプロビジョニングが短期で失効）か有料の Apple Developer Program（年額 $99）が要り、TestFlight・App Store・Ad Hoc 配布にも同じ Program が必須なため割愛しました（frontend-kotlin トラックの iOS も同様の理由で未着手）。

## 技術構成

| 領域 | 使用技術 |
| --- | --- |
| フロントエンド | TypeScript / React Native / Expo Router / TanStack Query / Tauri 2 |
| バックエンド | Python 3.14 / FastAPI / SQLModel / Alembic |
| ローカル基盤 | PostgreSQL 18 / MinIO / Docker Compose |
| AI校正 | 開発: Ollama `qwen3.5:9b`、本番: Anthropic API |
| 本番基盤 | AWS ECS Fargate / RDS PostgreSQL Multi-AZ / S3 + CloudFront / API Gateway / Terraform |
| 品質 | pytest / ruff / mypy / Jest / Playwright / GitHub Actions |

## すぐ試す: ローカルデモ

Windows PowerShellで確認済みの手順です。デモ環境は開発環境と完全に分離され、PostgreSQLは `5433`、MinIOは `9002` / `9003` を使用します。Ollama、GPU、外部APIキーは不要です。

前提: Docker Desktop、Python 3.14、Node.js（npm）。

```powershell
# 1. デモ専用のランダムなローカル設定を作る（.env.demoはGit管理外）
python backend/scripts/create_demo_env.py

# 2. デモ用のPostgreSQLとMinIOを起動する
docker compose --env-file .env.demo -f infra/docker-compose.demo.yml up -d

# 3. デモ用DBを準備し、バックエンドを起動する
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:APP_ENV = "demo"
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.seed_demo
.\.venv\Scripts\python.exe -m scripts.demo_seed_expansion
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

別のPowerShellでフロントエンドを起動します。

```powershell
cd expoApp
npm ci
$env:EXPO_PUBLIC_API_BASE_URL = "http://localhost:8000"
npm run web
```

起動後、Expoが表示したURLをブラウザで開いてログインしてください。全デモアカウントのパスワードは `DemoPass123!` です。

| 用途 | アカウント | 確認できること |
| --- | --- | --- |
| 基本操作 | `demo.chef@example.com` | レシピ一覧、画像、通知、フォロワー7人のプロフィール |
| 相互フォロー | `demo.ema@example.com` / `demo.riku@example.com` | 相互フォローと異なるフォロー数 |
| 未フォロー | `demo.kai@example.com` | フォロー0・フォロワー0の空状態 |
| 片方向フォロー | `demo.noa@example.com` | フォロー3・フォロワー1の状態 |

デモには10ユーザー、10レシピ、10コメント、10通知、レシピのサムネイル・手順画像を投入します。未お気に入りのレシピも含むため、お気に入り前後の表示も確認できます。

停止は次のコマンドです。`-v` を付けると**デモ用**DB・画像だけを初期化します。開発環境・AWSには影響しません。

```powershell
docker compose --env-file .env.demo -f infra/docker-compose.demo.yml down
# 完全に作り直す場合だけ
docker compose --env-file .env.demo -f infra/docker-compose.demo.yml down -v
```

## 開発・テスト

通常の開発環境はデモ環境とは別です。バックエンド、フロントエンド、環境変数の詳細はそれぞれのREADMEを参照してください。

- [バックエンドのセットアップ・テスト](backend/README.md)
- [Expo / Tauri フロントエンドのセットアップ・テスト](expoApp/README.md)
- [環境変数とシークレットの一覧](docs/requirements/environment.md)
- [テスト・CI/CD方針](docs/requirements/testing.md)

ローカルでAI校正を実モデルで試す場合は、Ollamaで `qwen3.5:9b` を取得し、`.env.development` を `AI_PROVIDER=local` に設定します。品質確認の手順と、本番のAnthropic構成は [AI誤字脱字チェックの仕様](docs/requirements/features/ai-proofread.md) を参照してください。

## 本番環境（AWS）

本番構成は Terraform で管理しています。API GatewayからVPC Link・Cloud Map・内部ALBを経由してECS Fargateへ接続し、RDS Multi-AZ、非公開S3 + CloudFront、CloudWatch + SNS、EventBridge Schedulerを利用します。

学習用のため、AWS環境は常時稼働させず、検証時だけ `terraform apply` を行い、終了後に `terraform destroy` します。初回構築、Secrets ManagerへのAPIキー登録、手動デプロイ、費用・後始末は [`infra/terraform/README.md`](infra/terraform/README.md) に記載しています。

## ドキュメント

- [要件定義書の索引](docs/requirements/README.md)
- [アーキテクチャ・リポジトリ構成](docs/requirements/architecture.md)
- [画面設計](docs/requirements/screens/README.md)
- [データモデル](docs/requirements/data-model.md)
- [API仕様](docs/requirements/api.md)
- [未対応・改善候補](docs/requirements/todo.md)

## 開発フロー

作業はGitHub Issueから開始し、専用ブランチとPull Requestを経由して `main` へ取り込みます。`main` への直接pushは行いません。
