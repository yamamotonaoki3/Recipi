# アーキテクチャ・リポジトリ構成

## リポジトリ構成（モノレポ）

現行 `Recipi` リポジトリに、**1 本の Python バックエンド**と **2 つのフロントエンドトラック**（TypeScript / Kotlin）を並置する。

```
Recipi/
├── settings.gradle.kts / build.gradle.kts   Kotlin フロントの Gradle モジュールを登録（backend / expoApp は含めない）
├── backend/        Python プロジェクト（FastAPI / Uvicorn）。Gradle 非登録
│   ├── app/            ルーティング、SQLModel テーブル定義、Pydantic モデル、認証依存性
│   ├── alembic/        マイグレーション（シード含む）
│   ├── requirements.txt / requirements-dev.txt
│   ├── pyproject.toml  ツール設定（ruff 等）、requires-python = ">=3.14,<3.15"
│   ├── .python-version  3.14.7（検証済みの固定バージョン）
│   └── Dockerfile      python:3.14.7-slim（タグを固定）
├── openapi/        backend が出力する openapi.json ＋ 生成設定（Kotlin: OpenAPI Generator ／ TS: openapi-typescript）
├── expoApp/        ★TypeScript トラック（必須）。Node / Expo プロジェクト。Gradle 非登録
│   ├── app/            Expo Router のルート（ファイルベース）
│   ├── src/            画面・コンポーネント（NativeWind）・状態・api（生成 schema.ts + openapi-fetch + TanStack Query）
│   ├── src-tauri/      Tauri 2（Windows・macOS デスクトップシェル。RN Web ビルドを読み込む）
│   ├── package.json / app.json / tsconfig.json
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
- ローカル実行は Docker Compose の `api` サービス（Uvicorn `--reload`）。本番の ASGI 実行構成は未定（→ [todo.md](todo.md)）。

## ローカル実行環境（Docker Compose）

`infra/docker-compose.yml` に以下のサービスを定義する。

| サービス | 役割 |
| --- | --- |
| `api` | FastAPI（Uvicorn）。backend |
| `postgres` | PostgreSQL |
| `minio` | S3 互換オブジェクトストレージ（画像保存。詳細は [features/image.md](features/image.md)） |

## 秘密情報の扱い（グローバル CLAUDE.md「秘密情報の標準取り扱い要件」準拠）

- DB 認証情報・JWT 署名鍵・ストレージ認証情報などの**実値は `.gitignore` 対象の `.env` にのみ置く**。
- `docker-compose.yml` などコミット対象ファイルは環境変数展開（`${DB_PASSWORD}` など）で参照し、実値を埋め込まない。
- 環境別の `.env.development.example` / `.env.test.example` / `.env.production.example` にプレースホルダのみを記載してコミットする（root CLAUDE.md「環境変数は開発 / テスト / 本番で分離」）。
- `root` / `password` / `admin` のような推測可能な値を使わない。
- 詳細な運用は [non-functional.md](non-functional.md) のセキュリティ節も参照。

## 本番デプロイ

- 未定。Fly.io / Render / AWS などを候補に別途検討する（→ [todo.md](todo.md)）。
