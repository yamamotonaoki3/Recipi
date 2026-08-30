# アーキテクチャ・リポジトリ構成

## リポジトリ構成（モノレポ）

現行 `Recipi` リポジトリに Gradle マルチプロジェクトで収める。

```
Recipi/
├── settings.gradle.kts / build.gradle.kts   モジュールを登録
├── shared/         KMP共有モジュール（commonMain）。@Serializable な DTO、APIパス定数、バリデーション、表示整形ロジック
├── backend/        Ktor Server（JVM）。ルーティング、Exposed テーブル定義、認証。implementation(project(":shared"))
├── composeApp/     Compose Multiplatform。commonMain / androidMain / iosMain / desktopMain、Ktor Client、画面/ViewModel。implementation(project(":shared"))
├── iosApp/         Xcode プロジェクト（iOS の殻）
├── desktopApp/     デスクトップ起動エントリ（main()）＋ Compose のパッケージ設定（.msi / .dmg）
├── infra/
│   └── docker-compose.yml   api + postgres + minio
├── docs/
│   └── requirements/       要件定義書（機能別）
├── .env.example
└── CLAUDE.md
```

- 利点: `shared` の DTO を backend / frontend が直接参照し、API 型の不一致を防ぐ。BE / FE 横断の変更を 1 PR でレビューできる。
- `composeApp` の UI コードは `commonMain` に集約し、Android / iOS / Desktop で共有。プラットフォーム固有部分（画像選択、カメラ、セキュアストレージ等）は `expect` / `actual` で `androidMain` / `iosMain` / `desktopMain` に実装する。
- `desktopApp` は Compose Multiplatform Desktop（JVM）のエントリポイントとパッケージング設定。`./gradlew :desktopApp:run` で起動、`packageDistributionForCurrentOS` で `.msi` / `.dmg` を生成。
- Gradle マルチモジュール（KMP + JVM 混在、desktop ターゲット含む）の詳細設定は Phase 0 で確定する（→ [todo.md](todo.md)）。

## `shared` モジュールに置くもの

- API のリクエスト / レスポンス DTO（`@Serializable`）
- API パス定数（`/api/v1/...`）
- バリデーションルール（文字数上限、必須チェックなど。フロント / バックで同じ定義を使う）
- 表示整形ロジック（材料の単位の前置 / 後置の組み立てなど。[features/unit.md](features/unit.md)）

## ローカル実行環境（Docker Compose）

`infra/docker-compose.yml` に以下のサービスを定義する。

| サービス | 役割 |
| --- | --- |
| `api` | Ktor Server（backend） |
| `postgres` | PostgreSQL |
| `minio` | S3 互換オブジェクトストレージ（画像保存。詳細は [features/image.md](features/image.md)） |

## 秘密情報の扱い（グローバル CLAUDE.md「秘密情報の標準取り扱い要件」準拠）

- DB 認証情報・JWT 署名鍵・ストレージ認証情報などの**実値は `.gitignore` 対象の `.env` にのみ置く**。
- `docker-compose.yml` などコミット対象ファイルは環境変数展開（`${DB_PASSWORD}` など）で参照し、実値を埋め込まない。
- `.env.example` にプレースホルダのみを記載してコミットする。
- `root` / `password` / `admin` のような推測可能な値を使わない。
- 詳細な運用は [non-functional.md](non-functional.md) のセキュリティ節も参照。

## 本番デプロイ

- 未定。Fly.io / Render / AWS などを候補に別途検討する（→ [todo.md](todo.md)）。
