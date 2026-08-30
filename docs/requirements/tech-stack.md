# 技術スタック

> バージョンは実装着手前に `resolve-tech-stack` スキルで確定し、このマシンでの利用可否（JDK / Android SDK / Xcode の要否含む）を検査する。以下は方針。

## フロントエンド

| 項目 | 採用 | 備考 |
| --- | --- | --- |
| 言語 | Kotlin | |
| UI | Compose Multiplatform | Android / iOS / Desktop を単一コードベース |
| 対象プラットフォーム | **Android / iOS / Desktop（Windows・macOS、JVM）** | ブラウザ（Web）は将来検討（→ [todo.md](todo.md)） |
| HTTP クライアント | Ktor Client | |
| シリアライズ | kotlinx.serialization | `shared` モジュールの DTO を共用 |
| 画像選択 / カメラ | KMP 対応ライブラリ（例: Peekaboo）を候補として調査。Desktop はファイル選択ダイアログ | → [todo.md](todo.md) |
| プラットフォーム固有機能 | `expect` / `actual` で吸収（画像選択、カメラ、セキュアストレージ 等） | → [todo.md](todo.md) |
| 状態管理 / DI | 実装時に選定（例: ViewModel + Koin） | → [todo.md](todo.md) |
| ナビゲーション | 実装時に選定（例: Compose Navigation / Decompose / Voyager） | → [todo.md](todo.md) |
| デスクトップ配布 | Compose Gradle プラグインの `packageDistributionForCurrentOS`（`.msi` / `.dmg`） | Java ランタイム同梱 |

## バックエンド

| 項目 | 採用 | 備考 |
| --- | --- | --- |
| 言語 | Kotlin | |
| フレームワーク | Ktor Server | |
| DB アクセス | Exposed（JetBrains製 ORM） | |
| コネクションプール | HikariCP | |
| DB ドライバ | PostgreSQL JDBC ドライバ | |
| マイグレーション | Flyway | シードデータもマイグレーションで投入 |
| 認証 | ktor-server-auth-jwt | JWT 検証 |
| パスワードハッシュ | bcrypt もしくは Argon2 | ライブラリは実装時に確定 |
| シリアライズ | kotlinx.serialization | |

## データベース

- PostgreSQL（メジャーバージョンは後日確定 → [todo.md](todo.md)）
- 検索用に `pg_trgm` 拡張の利用を検討 → [todo.md](todo.md)

## 共有モジュール（`shared`）

- KMP の `commonMain` に、API のリクエスト / レスポンス DTO、API パス定数、バリデーションルールを置き、フロントエンドとバックエンドの両方が `implementation(project(":shared"))` で参照する。
- これにより API 型の不一致（片方だけ修正漏れ）を防ぐ。

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

## 学習方針

- Ktor / Exposed / Compose Multiplatform はいずれも開発者にとって未経験。
- `learning-handover` スキルで学習用引き渡し資料を作成するが、**学習完了を待たずに本実装を進める**（資料は後日学習用、非ブロッキング）。作成は実装着手前に別タスクで行う。
