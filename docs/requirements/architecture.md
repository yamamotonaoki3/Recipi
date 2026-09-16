# アーキテクチャ・リポジトリ構成

## リポジトリ構成（モノレポ）

現行 `Recipi` リポジトリに、**1 本の Python バックエンド**と **2 つのフロントエンドトラック**（TypeScript / Kotlin）を並置する。

```
Recipi/
├── settings.gradle.kts / build.gradle.kts   Kotlin フロントの Gradle モジュールを登録（backend / expoApp は含めない）
├── .github/
│   └── workflows/  CI: backend.yml / frontend-ts.yml / contract.yml / e2e.yml（[testing.md](testing.md)）
├── backend/        Python プロジェクト（FastAPI / Uvicorn）。Gradle 非登録
│   ├── app/            ルーティング、SQLModel テーブル定義、Pydantic モデル、認証依存性、config.py（pydantic-settings）
│   │   └── ai/         AI 連携（校正サービスの抽象 ＋ local / anthropic / stub 実装。Phase 11）
│   ├── alembic/        マイグレーション（シード含む）
│   ├── tests/          pytest（単体・結合）。結合は実 Postgres / MinIO
│   ├── requirements.txt / requirements-dev.txt
│   ├── pyproject.toml  ツール設定（ruff / mypy / pytest）、requires-python = ">=3.14,<3.15"
│   ├── .python-version  3.14.7（検証済みの固定バージョン）
│   └── Dockerfile      python:3.14.7-slim（タグを固定）
├── openapi/        backend が出力する openapi.json ＋ 生成設定（Kotlin: OpenAPI Generator ／ TS: openapi-typescript）
├── expoApp/        ★TypeScript トラック（必須）。Node / Expo プロジェクト。Gradle 非登録
│   ├── app/            Expo Router のルート（ファイルベース）
│   ├── src/            画面・コンポーネント（NativeWind）・状態・api（生成 schema.ts + openapi-fetch + TanStack Query）
│   ├── src-tauri/      Tauri 2（Windows・macOS デスクトップシェル。RN Web ビルドを読み込む）
│   ├── __tests__/ or *.test.tsx   jest-expo + React Native Testing Library + MSW
│   ├── e2e/            E2E フロー（Phase 1 以降）。web/ = Playwright、android/ = Appium + WebdriverIO
│   ├── package.json / app.json / app.config.ts / tsconfig.json
├── shared/         ★Kotlin トラック。KMP共有モジュール（commonMain）。フロント内部の共通ロジック（単位の表示整形 等）＋ OpenAPI から生成した Kotlin API クライアント / DTO
├── composeApp/     ★Kotlin トラック。Compose Multiplatform。commonMain / androidMain / iosMain / desktopMain、Ktor Client、画面/ViewModel。implementation(project(":shared"))
├── iosApp/         ★Kotlin トラック。Xcode プロジェクト（iOS の殻）
├── desktopApp/     ★Kotlin トラック。デスクトップ起動エントリ（main()）＋ Compose のパッケージ設定（.msi / .dmg）
├── infra/
│   └── docker-compose.yml   api（FastAPI / Uvicorn） + postgres + minio（フロントは compose 外で実行）
├── docs/
│   └── requirements/       要件定義書（機能別）
├── .env.development.example / .env.test.example / .env.production.example
└── CLAUDE.md
```

## フロントエンドの 2 トラック

- **(A) TypeScript（`expoApp/`、必須トラック）** と **(B) Kotlin（`composeApp/` ほか、随時トラック）**は、どちらも **1 本の FastAPI** を、同じ API 契約（`openapi/openapi.json` ＋ 本要件定義書）で叩く。UI・画面実装はトラックごとに別。
- **API 型の整合**: 言語をまたぐためコンパイル時共有はできない。`openapi.json` を単一の正とし、Kotlin は OpenAPI Generator、TS は openapi-typescript でコードを生成する（[tech-stack.md](tech-stack.md) の「型共有」）。CI で再生成し、いずれかの生成物に差分が出たら失敗させる（契約テスト）。
- BE / FE 横断の変更は、API 契約（`openapi.json` と本要件定義書）を介してレビューする。
- 画面仕様（[screens/](screens/)）は **framework 非依存**で書き、両トラックが従う。
- 進め方は **TS が必須（期限あり）、Kotlin は随時（非ブロッキング）**。自動連続実行の完了判定は backend + frontend-ts で行う（[roadmap.md](roadmap.md) / root CLAUDE.md）。

### (A) TypeScript トラック（`expoApp/`）

- Expo（Expo Router）で iOS / Android。UI は NativeWind、データ取得は TanStack Query + openapi-fetch。
- **Desktop（Windows・macOS）**は `src-tauri/` の Tauri 2 が **React Native Web ビルド**を読み込み、`.msi` / `.dmg` を生成する。
- プラットフォーム固有機能は Expo モジュール（`expo-camera` / `expo-image-picker` / `expo-image-manipulator` / `expo-secure-store`）と Tauri プラグイン（デスクトップのセキュアストレージ 等）で吸収する。`expect`/`actual` は使わない。
- Expo プロジェクトの詳細構成（EAS / ローカルビルド、Tauri 連携）は Phase 0（frontend-ts）で確定する（→ [todo.md](todo.md)）。

### (B) Kotlin トラック（`shared/` `composeApp/` `iosApp/` `desktopApp/`）

- `composeApp` の UI コードは `commonMain` に集約し、Android / iOS / Desktop で共有。プラットフォーム固有部分（画像選択、カメラ、セキュアストレージ等）は `expect` / `actual` で `androidMain` / `iosMain` / `desktopMain` に実装する。
- `desktopApp` は Compose Multiplatform Desktop（JVM）のエントリポイントとパッケージング設定。`./gradlew :desktopApp:run` で起動、`packageDistributionForCurrentOS` で `.msi` / `.dmg` を生成。
- Gradle マルチモジュール（KMP + desktop ターゲット、`backend` / `expoApp` を含まない）の詳細設定は Phase 0（frontend-kotlin）で確定する（→ [todo.md](todo.md)）。

## `shared` モジュールに置くもの（Kotlin トラック）

- OpenAPI から生成した Kotlin API クライアント / DTO（リクエスト / レスポンス型、`/api/v1/...` パス）
- 表示整形ロジック（材料の単位の前置 / 後置の組み立てなど。[features/unit.md](features/unit.md)）
- クライアント側の入力チェック（文字数上限などの規則値は本要件定義書を正とする）
- TypeScript トラックはこのモジュールを参照せず、`expoApp` 内に同等物を持つ。

## バックエンド（Python）

- `app/` に FastAPI アプリ。DB アクセスは SQLModel（SQLAlchemy 2.0）、ドライバは psycopg 3、接続は `postgresql+psycopg://`。
- スキーマ変更は Alembic マイグレーションで管理し、`units` などのシードデータも Alembic で投入する。SQLModel のモデル定義で表現できない DB 制約（複合外部キー・部分インデックス・`CHECK`・トリガー）は手書きマイグレーションで補う（[data-model.md](data-model.md)）。
- ローカル開発は Docker Compose で `postgres` / `minio` を起動し、バックエンドは `uvicorn --reload` でホスト実行する（高速な反復のため）。フルスタック実行（E2E 等）は Compose の `api` サービス。`.env.*` のホスト名の扱いは [environment.md](environment.md) §4。本番の ASGI 実行構成は **uvicorn の単一プロセス**（ECS Fargate 0.25 vCPU / 0.5GB・1 タスク。`infra/terraform/ecs.tf`。Issue #165）。Gunicorn 等でワーカーを増やすかは、実際の負荷を測ってから判断する。
- **AI 連携（`app/ai/`、Phase 11）**: 校正サービスの抽象（Protocol）＋ 実装（`local` / `anthropic` / `stub`）。`AI_PROVIDER` 環境変数で選択（[tech-stack.md](tech-stack.md) / [features/ai-proofread.md](features/ai-proofread.md)）。`api` サービスには `AI_PROVIDER` と（production のみ）`ANTHROPIC_API_KEY` を環境変数で渡す（`docker-compose.yml` は `${...}` 参照、実値は `.env`）。dev のローカル推論用サービス（例: `ollama`）を compose に追加するかは Phase 11 の spike（→ [todo.md](todo.md)）。将来の他の AI 機能も同じ `app/ai/` と `/api/v1/ai/` 名前空間に置く。

### 処理方式（トランザクション / 同期 / 非同期 / バッチ）

詳細は [non-functional.md](non-functional.md) と、機能横断の正である [processing-model.md](processing-model.md)。方針:

- **1 リクエスト = 1 DB トランザクション**を原則とし、外部 I/O（ストレージ・AI プロバイダ）はトランザクション外に置く。
- レスポンス後の即時の後処理（通知 fan-out）は **FastAPI `BackgroundTasks`**（プロセス内・ブローカー無し）。失われても整合性を壊さないものだけを載せる。削除キューへの行 INSERT や単一行の通知は発火元と同一トランザクション（DB だけで完結し取りこぼしを避けたいため）。
- 定期処理（カウント列補正・一時アップロード GC・ストレージ削除ジョブ・期限切れトークン / 古い通知の掃除・閲覧履歴の上限・通知 outbox のスイープ。コマンドは Issue #70・#72 で実装済み）は **`backend/` の管理用 CLI コマンドを cron / コンテナスケジューラで起動**する。`api` サービスに常駐スレッドは持たせない。Docker Compose への新サービス追加は無し（スケジューラはホスト / オーケストレータ側）。
- 専用ジョブキュー（arq / Celery + Redis）は Phase 10 以降に必要性を測って再検討（[processing-model.md](processing-model.md) §3）。

## ローカル実行環境（Docker Compose）

`infra/docker-compose.yml` に以下のサービスを定義する。

| サービス | 役割 |
| --- | --- |
| `api` | FastAPI（Uvicorn）。backend。`AI_PROVIDER` 等の環境変数を受け取る |
| `postgres` | PostgreSQL |
| `minio` | S3 互換オブジェクトストレージ（画像保存。詳細は [features/image.md](features/image.md)）。イメージは `quay.io/minio/minio` のリリースタグ固定（[environment.md](environment.md) §4・Issue #89） |
| `ollama`（Phase 11・要検討） | dev の AI 校正のローカル推論。追加するかは spike（→ [todo.md](todo.md)） |

## テスト / CI

- `.github/workflows/` に GitHub Actions のワークフローを置く（`backend.yml` / `frontend-ts.yml` / `contract.yml` / `e2e.yml`）。方針・レイヤー・ツール・カバレッジは [testing.md](testing.md) を正とする。
- backend の結合テストは GitHub Actions の `services:`（PostgreSQL）＋ MinIO コンテナを使い、Alembic マイグレーションを適用した使い捨て DB に対して API を叩く。
- CD は **手動実行のデプロイのワークフロー**（`.github/workflows/deploy-backend.yml`。Issue #167）。main への push で自動デプロイはしない（学習用で、使うときだけ環境を立てるため）。CI 側は従来どおりビルド / パッケージ検証を行う（[testing.md](testing.md) §6）。
- `infra/**` を変更する PR では Terraform の `fmt -check` / `validate` も回す（`.github/workflows/terraform.yml`。AWS には接続しない）。マージの必須チェックには含めない。

## 秘密情報の扱い（グローバル CLAUDE.md「秘密情報の標準取り扱い要件」準拠）

> 全環境変数の一覧と各値の性質は [environment.md](environment.md)。

- DB 認証情報・JWT 署名鍵・ストレージ認証情報・**AI プロバイダの API キー（`ANTHROPIC_API_KEY` 等）**などの**実値は `.gitignore` 対象の `.env` にのみ置く**。
- `docker-compose.yml` などコミット対象ファイルは環境変数展開（`${DB_PASSWORD}`・`${ANTHROPIC_API_KEY}` など）で参照し、実値を埋め込まない。
- 環境別の `.env.development.example` / `.env.test.example` / `.env.production.example` にプレースホルダのみを記載してコミットする（root CLAUDE.md「環境変数は開発 / テスト / 本番で分離」）。AI 関連は `.env.development.example` に `AI_PROVIDER=local`、`.env.test.example` に `AI_PROVIDER=stub`、`.env.production.example` に `AI_PROVIDER=anthropic` / `ANTHROPIC_API_KEY=`（プレースホルダ）。
- `root` / `password` / `admin` のような推測可能な値を使わない。
- 詳細な運用は [non-functional.md](non-functional.md) のセキュリティ節も参照。

## 本番デプロイ

**AWS**（リージョン: ap-northeast-1）。構成は Terraform で管理する（`infra/terraform/`。Issue #165・#172・#173）。手順の詳細は [`infra/terraform/README.md`](../../infra/terraform/README.md)。

```text
クライアント ─HTTPS─> API Gateway HTTP API ─ VPC Link（private サブネット・専用 SG）
                        └─> Cloud Map(SRV: IP＋ポート) ─> ECS Fargate(private):8000
画像        ─HTTPS─> CloudFront ─OAC─> S3(uploads/* のみ。バケットは非公開)
定期ジョブ   EventBridge Scheduler ─> ECS RunTask（API と同じタスク定義の command を上書き）
デプロイ     GitHub Actions（手動実行・OIDC）─> ECR push → タスク定義更新 → マイグレーション → サービス更新
監視        CloudWatch Logs ＋ メトリクスフィルタ・アラーム ─> SNS（メール）
              アプリ・監査ログ  /ecs/recipi-api            … 365 日
              API Gateway       /aws/apigateway/recipi-api … 30 日
VPC 2AZ: public x2（IGW・NAT 1 つ）/ private x2（ECS・RDS・VPC Link の ENI）
         S3 へはゲートウェイ型エンドポイント（無料。ECR のイメージ取得が NAT を通らない）
```

- **通信の許可は 2 つだけ**に絞る（`security-groups.tf`）: 「VPC Link の SG → ECS の 8000 番」「ECS の SG → RDS の 5432 番」。ECS のタスクに公開 IP は付けず、RDS も外部に公開しない。外向きの通信は NAT 経由。
- **DB** は RDS PostgreSQL 18（db.t4g.micro・シングル AZ・private サブネット）。**画像**は非公開の S3 バケットで、配信は CloudFront の OAC 経由のみ（`uploads/*` の `GetObject` だけ許可）。アプリは ECS のタスクロールで S3 を読み書きし、アクセスキーを持たない（Issue #166）。
- **クライアント IP** は API Gateway が専用ヘッダー `X-Recipi-Client-Ip` に入れて渡し、アプリは接続元が VPC Link の private サブネットのときだけその値を信頼する（`backend/app/request_utils.py`。Issue #166）。

### デプロイの流れ

1. **初回のみ**: tfstate 用バケットを作る → ECR リポジトリだけ先に apply → イメージをビルドして push → そのタグを `backend_image_tag` にして本体を apply → マイグレーションを `aws ecs run-task` で 1 回流す。
2. **以降**: GitHub Actions の `deploy-backend` ワークフローを手動実行する。ECR への push → タスク定義の更新 → マイグレーション → サービス更新 → `/healthz`・`/healthz/db` の確認までを 1 回で行い、失敗したら前のタスク定義に戻す。
3. 定期ジョブは EventBridge Scheduler が同じタスク定義で `command` を差し替えて起動する（常駐ワーカーは置かない。[processing-model.md](processing-model.md) §8）。

手順の全文（`-target` を使う理由・GitHub Secrets の登録・destroy・費用の目安）は [`infra/terraform/README.md`](../../infra/terraform/README.md) を正とする。

### トレードオフ（学習用の構成としての判断）

- **使うときだけ `apply` し、確認が終わったら `destroy` する**運用。常時稼働させない前提で、固定費の小さい構成を選んでいる。
- **ALB を使わない**（固定費がかかる）。代わりに API Gateway HTTP API ＋ VPC Link ＋ Cloud Map で private の ECS に到達する。
- **NAT Gateway は 1 つ**（1 つ目の AZ）。その AZ が落ちると ECS が外に出られない。冗長化するなら AZ ごとに置く。
- **RDS はシングル AZ・`skip_final_snapshot = true`・`deletion_protection = false`**。destroy でデータは消える。長く使う本番なら逆にする。
- **Container Insights は有効にしない**（観測データごとの課金を避ける）。タスク数は標準メトリクスの欠損で代用して監視する。
- 秘密（DB のパスワード・JWT の鍵・`LOG_HASH_SECRET`）は Terraform の `ephemeral` リソースと書き込み専用の引数（`password_wo` / `secret_string_wo`）で扱い、**tfstate にも plan にも実値を残さない**（Issue #165）。実行時は Secrets Manager からタスクの環境変数として渡される。
