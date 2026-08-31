# 技術スタック

> バージョンは実装着手前に `resolve-tech-stack` スキルで確定し、このマシンでの利用可否（JDK / Android SDK / Xcode の要否含む）を検査する。以下は方針。

## フロントエンド

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

> 将来アプリ内に AI 認識機能（画像からの自動認識など）を取り入れる学習目的で、バックエンドは Python 構成とする（`resolve-tech-stack` スキルで確定）。

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
| パッケージ管理 | venv + pip + requirements.txt | 従来方式で学習する。2026 年の主流は `uv` だが、まず仕組みを理解してから `uv` を試して比較する（→ [todo.md](todo.md)） |

## データベース

- PostgreSQL（メジャーバージョンは後日確定 → [todo.md](todo.md)）
- 検索用に `pg_trgm` 拡張の利用を検討 → [todo.md](todo.md)

## 型共有（OpenAPI コード生成）

バックエンドが Python、フロントエンドが Kotlin のため、コンパイル時に DTO を共有できない。代わりに **API 契約（OpenAPI）を単一の正**とし、そこから Kotlin コードを生成する。

- FastAPI が型ヒントとレスポンスモデルから **OpenAPI 3.1** 仕様（`openapi.json`）を自動生成する。
- **OpenAPI Generator** で、その仕様から Kotlin の API クライアント / DTO を生成する（Ktor Client 向けジェネレータを想定。最終選定は → [todo.md](todo.md)）。
- 生成物はフロントの `shared` モジュールに取り込む。CI で `openapi.json` を再生成し差分が出たら失敗させる（契約テスト）。

## 共有モジュール（`shared`）

- 今後の `shared`（KMP `commonMain`）の役割は次の 2 つ:
  1. **フロント内部の共通ロジック**（材料の単位の前置 / 後置表示の組み立てなど。[features/unit.md](features/unit.md)）。
  2. **OpenAPI から生成した API クライアント / DTO の置き場**。
- バリデーションはサーバー（Pydantic）とクライアント（生成物 ＋ 手書きの入力チェック）で別実装になる。文字数上限などの規則値は本要件定義書を正とする。

## インフラ / 実行環境

- ローカル開発は **Docker Compose 中心**（`api` + `postgres` + `minio`）。詳細は [architecture.md](architecture.md)。
- 本番デプロイ先は未定（別途検討 → [todo.md](todo.md)）。

## ライセンス・費用

- **Kotlin Multiplatform / Compose Multiplatform は無料・オープンソース（Apache 2.0、JetBrains 製）。** ビルド・実行・配布にライセンス料はかからない（デスクトップアプリ含む）。IDE も IntelliJ IDEA Community / Android Studio は無料。
- 費用が発生するのは**ストア配布・コード署名**で、これはフレームワーク非依存:
  - Apple Developer Program $99/年（iOS 配布、macOS アプリの notarization）
  - Google Play Developer $25（一度きり。APK 直接配布は不要）
  - Microsoft Store 登録 約 $19（一度きり。`.exe` / `.msi` 直接配布は不要）
  - Windows コード署名証明書 年 $100〜400 程度（任意。SmartScreen 警告回避用）
- **課題提出・メンターへのデモ**: `packageDistributionForCurrentOS` で生成した `.msi` / `.dmg` を渡す、または自分の PC で `./gradlew run` ＋ 画面共有。いずれも無料。コード署名なしだと OS が「発行元不明」の警告を出すが、Windows は「詳細情報 → 実行」、macOS は右クリック →「開く」で回避できる。Java ランタイムは同梱されるためメンター側の事前準備は不要。
- **バックエンドの Python スタック（FastAPI / Uvicorn / SQLModel / SQLAlchemy / Alembic / Pydantic / psycopg / argon2-cffi / PyJWT）はすべて OSS で無料**（MIT / Apache 2.0 / BSD / PSF）。Python 本体も同様。

## 学習方針

- FastAPI / SQLModel / Python はいずれも開発者にとって未経験。Compose Multiplatform も未経験。
- Python を選んだ主目的は、**今後アプリ内に AI 認識機能を取り入れる**こと（Python の AI エコシステムを活かす学習）。
- パッケージ管理は学習のためまず従来方式（venv + pip + requirements.txt）で進め、後で `uv` に置き換えて何が変わるか比較する（→ [todo.md](todo.md)）。
- `learning-handover` スキルで学習用引き渡し資料（FastAPI / SQLModel / Compose Multiplatform）を作成するが、**学習完了を待たずに本実装を進める**（資料は後日学習用、非ブロッキング）。作成は実装着手前に別タスクで行う。
