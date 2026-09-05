# 技術スタック

> バージョンは実装着手前に `resolve-tech-stack` スキルで確定し、このマシンでの利用可否（JDK / Android SDK / Xcode の要否含む）を検査する。backend の Python 構成とフロントの主要バージョンは確定済み（環境チェック 2026-09-01。未導入ツールは [todo.md](todo.md)）。以下は方針。

## フロントエンド

フロントエンドは **2 つの実装トラック**を持つ。どちらも同じバックエンド（1 本の FastAPI）を、同じ API 契約（`openapi.json` ＋ 本要件定義書）で叩く。

- **(A) TypeScript（必須トラック）**: カリキュラム指定。期限ありで進める。
- **(B) Kotlin Multiplatform（随時トラック）**: 開発者の学習用。非ブロッキングで自分のペースで進める（自動連続実行の完了条件には含めない。[roadmap.md](roadmap.md) / root CLAUDE.md）。

画面仕様（[screens/](screens/)）は **framework 非依存**で書き、両トラックが同じ仕様に従う。

### (A) TypeScript トラック（必須）

> バージョンは `resolve-tech-stack` の環境チェック（2026-09-01）で確定。詳細・未導入ツールは [todo.md](todo.md)。

| 項目 | 採用 | 備考 |
| --- | --- | --- |
| 言語 | TypeScript | |
| ランタイム | **Node.js 24.x（現行 LTS）** | このマシンに 24.19.0 導入済み。Expo SDK 57 の最低要件 Node 22.13 を満たす |
| フレームワーク | React Native + **Expo（SDK 57）** | **React Native 0.86**、New Architecture（Fabric / TurboModules）。2026 の RN 標準構成 |
| ルーティング | **Expo Router**（ファイルベース） | React Navigation の上に乗る。web / ネイティブ共通 |
| パッケージマネージャ | **npm**（11.x、Node 同梱） | pnpm / yarn は使わない |
| 対象プラットフォーム | iOS / Android（Expo ネイティブ）＋ **Desktop（Windows・macOS）** | Desktop は下記のとおり RN Web ビルドを Tauri で包む |
| Desktop シェル | **Tauri 2**（core 2.11 系、システム WebView + Rust コア） | RN Web（React Native Web）ビルドを読み込み、`.msi` / `.dmg` を生成。Electron より軽量。**最低 Rust 1.77.2**、Windows は **MSVC C++ Build Tools ＋ WebView2**（WebView2 は導入済み）が前提 |
| UI / スタイル | **NativeWind**（Tailwind for RN） | デザイントークン・ダークモード対応の詳細は → [todo.md](todo.md) |
| HTTP / 型 | **openapi-typescript**（型生成）＋ **openapi-fetch**（軽量クライアント） | `openapi.json` から型と fetch を生成。詳細は「型共有」節 |
| データ取得 / キャッシュ | **TanStack Query** | 一覧のカーソルページング（`useInfiniteQuery`）、楽観更新 |
| 状態管理（クライアント状態） | **Zustand**（Issue #34 で確定） | 認証トークン・UI トグルなど「サーバーから取らない」少量の状態。サーバーデータは TanStack Query |
| テスト | jest（`jest-expo` preset）＋ `@testing-library/react-native` ＋ `test-renderer` | ESLint 9 ＋ Prettier ＋ `tsc --noEmit`。MSW は jest-expo の RN 環境と相性が悪く Phase 1 で node 環境用に整える（[testing.md](testing.md)） |
| バージョン固定 | `expoApp/package-lock.json`（CI は `npm ci`） | `.npmrc` に `legacy-peer-deps=true`（RN/Expo の peer 依存ずれを許容する実務的設定）。Issue #34 で確定 |
| ネイティブ機能 | Expo モジュール（`expo-camera` / `expo-image-picker` / `expo-image-manipulator` / `expo-secure-store`）＋ Tauri プラグイン（デスクトップ） | `expect`/`actual` は使わない（RN の仕組みが吸収する） |
| ビルド / 配布 | EAS Build（クラウド）or ローカルビルド、Tauri の `.msi` / `.dmg` | iOS のローカルビルドは Windows では不可 → EAS Build（クラウド）。詳細 → [todo.md](todo.md) |

### (B) Kotlin Multiplatform トラック（随時）

| 項目 | 採用 | 備考 |
| --- | --- | --- |
| 言語 | Kotlin | |
| UI | Compose Multiplatform | Android / iOS / Desktop を単一コードベース |
| 対象プラットフォーム | **Android / iOS / Desktop（Windows・macOS、JVM）** | ブラウザ（Web）は将来検討（→ [todo.md](todo.md)） |
| HTTP クライアント | Ktor Client | |
| シリアライズ | kotlinx.serialization | OpenAPI から生成した Kotlin クライアント / DTO で使用 |
| 画像選択 / カメラ | KMP 対応ライブラリ（例: Peekaboo）を候補として調査。Desktop はファイル選択ダイアログ | → [todo.md](todo.md) |
| プラットフォーム固有機能 | `expect` / `actual` で吸収（画像選択、カメラ、セキュアストレージ 等） | → [todo.md](todo.md) |
| 状態管理 / DI | 実装時に選定（例: ViewModel + Koin） | → [todo.md](todo.md) |
| ナビゲーション | 実装時に選定（例: Compose Navigation / Decompose / Voyager） | → [todo.md](todo.md) |
| デスクトップ配布 | Compose Gradle プラグインの `packageDistributionForCurrentOS`（`.msi` / `.dmg`） | Java ランタイム同梱 |

## バックエンド

> 将来アプリ内に AI 機能（レシピの誤字脱字チェック、画像からの自動認識など）を取り入れる学習目的で、バックエンドは Python 構成とする（`resolve-tech-stack` スキルで確定）。AI 連携の詳細は下記「AI 連携」節。

| 項目 | 採用 | 備考 |
| --- | --- | --- |
| 言語 | Python 3.14.7（固定） | このマシンに導入済み。必要な C 拡張ライブラリの Windows ビルド済み wheel を 3.14.7 で確認済み（`uvloop` のみ Windows 非対応だが Uvicorn が自動スキップするため影響なし）。`.python-version` で 3.14.7 を固定、`requires-python = ">=3.14,<3.15"`、Docker は `python:3.14.7-slim` |
| フレームワーク | FastAPI | ASGI。型ヒントから OpenAPI 3.1 を自動生成、Pydantic v2 でバリデーション |
| ASGI サーバー | Uvicorn | 開発は `--reload`。本番の実行構成（Uvicorn workers / Gunicorn / Granian）は未定（→ [todo.md](todo.md)） |
| ORM | SQLModel | SQLAlchemy 2.0 + Pydantic のラッパー。FastAPI 公式チュートリアル推奨。複雑な制約は生 SQLAlchemy に降りる |
| DB ドライバ | psycopg 3（`psycopg[binary]`） | SQLAlchemy エンジンは `postgresql+psycopg://` |
| マイグレーション | Alembic（読み: アレンビック） | SQLAlchemy 作者製。直接利用。シードデータも Alembic マイグレーションで投入。SQLModel のモデルで表現できない制約（複合 FK・部分インデックス・`CHECK`・トリガー）は手書きマイグレーションで補う（[data-model.md](data-model.md)） |
| バリデーション / シリアライズ | Pydantic v2 | FastAPI 標準。リクエスト / レスポンスモデル |
| 認証 | FastAPI の Bearer 認証依存性 + JWT ライブラリ（未確定） | `Authorization: Bearer` を検証する独自の依存性で `token_version` を照合（[non-functional.md](non-functional.md)）。ログイン / リフレッシュのリクエストは [features/auth.md](features/auth.md) のとおり JSON（`{ email, password, rememberMe }` 等）で、標準 OAuth2 のフォーム形式は使わない。JWT ライブラリは PyJWT / Authlib から選定（python-jose はメンテ停滞のため回避）→ [todo.md](todo.md) |
| パスワードハッシュ | Argon2id（`argon2-cffi`） | パスワード・秘密の質問の答えに使用 |
| パッケージ管理 | venv + pip + requirements.txt | 従来方式で学習する。2026 年の主流は `uv` だが、まず仕組みを理解してから `uv` を試して比較する（→ [todo.md](todo.md)）。各パッケージのバージョンは `backend/requirements.txt` / `requirements-dev.txt` で `==` 固定（Issue #33 で Python 3.14.7 上で確定・wheel 確認済み） |
| DB メジャーバージョン | **PostgreSQL 18**（`postgres:18`） | サポート期間 ~2030-11。Issue #33 で確定（→ [todo.md](todo.md) #5） |
| 構造化ログ | 標準 `logging` ＋ `python-json-logger` ＋ `contextvars` のリクエスト ID | Issue #33。`structlog` への移行は後日可（→ [todo.md](todo.md) #44） |
| Lint / 型 / テスト | ruff ／ mypy（strict）／ pytest（＋ pytest-asyncio / pytest-cov / httpx） | [testing.md](testing.md)。バージョンは `backend/requirements-dev.txt` |

### AI 連携（レシピの誤字脱字チェック — Phase 11）

**プラグ可能なプロバイダ**。`backend/app/ai/` に校正サービスの抽象（Protocol）を置き、`AI_PROVIDER` 環境変数で実装を切り替える。API 契約（`POST /api/v1/ai/proofread`、[features/ai-proofread.md](features/ai-proofread.md)）はプロバイダに依存しない。

| 環境 | `AI_PROVIDER` | 実装 | 内容 |
| --- | --- | --- | --- |
| development | `local` | `LocalProofreadProvider` | ローカル推論。Docker Compose の Ollama コンテナ（量子化した小型モデル・CPU 可）または in-process の小型 GEC モデル。API 課金ゼロ・オフライン可。「Python でローカル推論を動かす」学習を兼ねる |
| production | `anthropic` | `AnthropicProofreadProvider` | クラウド LLM API。第一候補 **Anthropic API（Claude Haiku）** ／ `anthropic` Python SDK。`ANTHROPIC_API_KEY` は本番のシークレット管理で注入。OpenAI（`openai` SDK）は差し替え可能な代替 |
| test | `stub` | `StubProofreadProvider` | 決定的なダミー。モデル・API キー不要（CI に GPU も鍵も要らない） |

- 具体モデル・dev の実行方式（compose サービス vs in-process）・モデルバージョンの最終ロックは Phase 11 着手前の spike（→ [todo.md](todo.md) #45）。
- ローカルの小型モデルはクラウドより精度が落ちるため、同じ入力でも development と production で校正結果が変わりうる（「提案」機能なので許容。[non-functional.md](non-functional.md)）。
- 秘密情報（`ANTHROPIC_API_KEY` 等）はグローバル CLAUDE.md「秘密情報の標準取り扱い要件」に従う（`.env` のみ、`.env.*.example` はプレースホルダ）。

## データベース

- PostgreSQL（メジャーバージョンは後日確定 → [todo.md](todo.md)）
- 検索用に `pg_trgm` 拡張の利用を検討 → [todo.md](todo.md)

## 型共有（OpenAPI コード生成）

バックエンド（Python）と 2 つのフロント（TypeScript / Kotlin）は言語が違うため、コンパイル時に型を共有できない。代わりに **API 契約（OpenAPI）を単一の正**とし、そこから各言語のコードを生成する。

- FastAPI が型ヒントとレスポンスモデルから **OpenAPI 3.1** 仕様（`openapi.json`）を自動生成する。
- **Kotlin トラック**: **OpenAPI Generator** で Kotlin の API クライアント / DTO を生成（Ktor Client 向けジェネレータを想定。最終選定は → [todo.md](todo.md)）。生成物は `shared` モジュールに取り込む。
- **TypeScript トラック**: **openapi-typescript** で型定義（`schema.ts`）を生成し、**openapi-fetch** で型安全な fetch クライアントを構成する。生成物は `expoApp` に取り込む。生成の CI 組み込み・差分チェックの詳細は → [todo.md](todo.md)。
- CI で `openapi.json` を再生成し、いずれかの生成物に差分が出たら失敗させる（契約テスト）。

## 共有ロジックの置き場

- **Kotlin トラック**: `shared`（KMP `commonMain`）に、(1) フロント内部の共通ロジック（材料の単位の前置 / 後置表示の組み立てなど。[features/unit.md](features/unit.md)）、(2) OpenAPI から生成した API クライアント / DTO を置く。詳細は [architecture.md](architecture.md)。
- **TypeScript トラック**: `expoApp` 内に同等物（表示整形・入力チェック・生成した API クライアント）を持つ。`shared` は参照しない。
- バリデーションはサーバー（Pydantic）と各クライアントで別実装になる。文字数上限などの規則値は本要件定義書を正とする。

## インフラ / 実行環境

- ローカル開発は **Docker Compose 中心**（`api` + `postgres` + `minio`）。詳細は [architecture.md](architecture.md)。
- 本番デプロイ先は未定（別途検討 → [todo.md](todo.md)）。

## ライセンス・費用

- **TypeScript トラック（React Native / Expo / Expo Router / React Native Web / Tauri / NativeWind / TanStack Query / openapi-typescript / openapi-fetch）はすべて OSS で無料**（MIT / Apache 2.0）。Expo は EAS のクラウドビルドに無料枠＋有料プランがあるが、ローカルビルドなら費用は発生しない（→ [todo.md](todo.md)）。
- **Kotlin Multiplatform / Compose Multiplatform も無料・オープンソース（Apache 2.0、JetBrains 製）。** ビルド・実行・配布にライセンス料はかからない（デスクトップアプリ含む）。IDE も IntelliJ IDEA Community / Android Studio は無料。
- 費用が発生するのは**ストア配布・コード署名**で、これはフレームワーク非依存:
  - Apple Developer Program $99/年（iOS 配布、macOS アプリの notarization）
  - Google Play Developer $25（一度きり。APK 直接配布は不要）
  - Microsoft Store 登録 約 $19（一度きり。`.exe` / `.msi` 直接配布は不要）
  - Windows コード署名証明書 年 $100〜400 程度（任意。SmartScreen 警告回避用）
- **課題提出・メンターへのデモ（TypeScript トラック）**: Tauri で生成した `.msi` / `.dmg` を渡す、または `npm run tauri dev` ＋ 画面共有。コード署名なしだと OS が「発行元不明」の警告を出すが、Windows は「詳細情報 → 実行」、macOS は右クリック →「開く」で回避できる。署名は課題提出時は不要。
- **課題提出・メンターへのデモ（Kotlin トラック）**: `packageDistributionForCurrentOS` で生成した `.msi` / `.dmg` を渡す、または `./gradlew run` ＋ 画面共有。Java ランタイムは同梱されるためメンター側の事前準備は不要。
- **バックエンドの Python スタック（FastAPI / Uvicorn / SQLModel / SQLAlchemy / Alembic / Pydantic / psycopg / argon2-cffi / PyJWT）はすべて OSS で無料**（MIT / Apache 2.0 / BSD / PSF）。Python 本体も同様。

## 学習方針

- **TypeScript / React / Expo はカリキュラム指定の必須トラック**。期限に沿って進める。開発者は React も未経験。
- **Kotlin Multiplatform / Compose は開発者が自分で試したい随時トラック**。必須トラックの進捗をブロックしない範囲で、自分のペースで実装する。
- FastAPI / SQLModel / Python も未経験。Python を選んだ主目的は、**今後アプリ内に AI 機能を取り入れる**こと（Python の AI エコシステムを活かす学習）。
- **AI 校正のローカル推論は Recipi の development 環境で動かして学習する**（transformers / Ollama / 量子化）。本番はクラウド API に切り替える（上記「AI 連携」）。`learning-handover` で事前学習資料を作るかは Phase 11 前に判断（非ブロッキング）。
- パッケージ管理（backend）は学習のためまず従来方式（venv + pip + requirements.txt）で進め、後で `uv` に置き換えて比較する（→ [todo.md](todo.md)）。
- `learning-handover` スキルで学習用引き渡し資料（React Native / Expo / FastAPI / SQLModel、随時トラック用に Compose Multiplatform）を作成するが、**学習完了を待たずに本実装を進める**（資料は後日学習用、非ブロッキング）。作成は実装着手前に別タスクで行う。
