# 未確定事項 / 要調査（TODO）

| # | 項目 | 対応時期 | 関連 |
| --- | --- | --- | --- |
| 2 | 本番デプロイ先（Fly.io / Render / AWS 等）の選定 | Phase 10 前後 | [architecture.md](architecture.md) |
| 3 | iOS ビルド環境。**TS トラック**: Windows ではローカルビルド不可 → EAS Build（クラウド）で iOS を扱う（Apple Developer Program $99/年が必要になる時期を検討）。**Kotlin トラック**（随時）: `iosApp` のビルド・実行に Mac + Xcode が必須 | Phase 0 / iOS 着手時 | [tech-stack.md](tech-stack.md) |
| 4 | 画像ピッカー / カメラ / トリミングの具体選定。**TS トラック**: `expo-image-picker` / `expo-camera` / `expo-image-manipulator`、デスクトップ（Tauri）は getUserMedia / ファイル選択。**Kotlin トラック**: KMP 対応ライブラリ | Phase 3 / Phase 5 | [features/image.md](features/image.md) |
| 5 | 各ツールのバージョン確定（`resolve-tech-stack`）。**確定済み（環境チェック 2026-09-01）**: Python 3.14.7（`.python-version` / `requires-python = ">=3.14,<3.15"` / `python:3.14.7-slim`、wheel 確認済み）／ Node.js 24.x ／ Expo SDK 57・React Native 0.86 ／ npm ／ Tauri 2（最低 Rust 1.77.2）／ Docker 29 + Compose v5（稼働中）／ Gradle 9.5。**未定**: PostgreSQL メジャーバージョン、frontend-kotlin の Android ビルド用 JDK（まず 25 のまま試し AGP 対応を着手時に確認） | 実装着手前 | [tech-stack.md](tech-stack.md) |
| 49 | **このマシンに未導入で Phase 0 前にユーザーがインストールするもの**: (1) Rust ツールチェーン（rustup/cargo、Tauri 必須）(2) Microsoft C++ Build Tools（Tauri の Windows ビルド必須）(3) Android SDK / Android Studio（両トラックの Android ビルド必須、`ANDROID_HOME` 設定）。iOS は #3 参照。導入後に `resolve-tech-stack` の利用可否検査を再実行 | Phase 0 前 | [tech-stack.md](tech-stack.md) |
| 6 | Android minSdk / iOS 対応下限の確定 | Phase 0 | [non-functional.md](non-functional.md) |
| 7 | フロントの状態管理 / DI / ナビゲーションライブラリの選定。**TS**: クライアント状態ライブラリの選定（Zustand / Jotai）、TanStack Query（採用済み）のキャッシュ / 無効化方針、Expo Router の運用。**Kotlin**: ViewModel / Koin / Compose Navigation 等 | Phase 0 | [tech-stack.md](tech-stack.md) |
| 8 | S3 互換ストレージの本番サービス選定（R2 / S3 等）、署名付き URL か公開バケットか | Phase 3〜10 | [features/image.md](features/image.md) |
| 9 | 検索: `pg_trgm` 拡張の採否、`title_normalized` / `name_normalized` の正規化仕様（かな / カナ・送り仮名ゆれをどこまで吸収するか）、`q` の語数・長さ上限 | Phase 4 | [features/search.md](features/search.md) |
| 9b | ホームの検索窓: スクロール時の挙動（完全固定 / 縮小）、確定タイミング（Enter のみ / 入力停止でインクリメンタル）、検索履歴・サジェスト（将来） | Phase 4 | [screens/home.md](screens/home.md), [features/search.md](features/search.md) |
| 9c | ボトムナビ / レールのレイアウトの見た目（5 destination = ホーム / 履歴 / ＋ / 通知 / マイページ。「＋」は中央 3 番目・目立つスタイル） | Phase 4 | [screens/navigation.md](screens/navigation.md), [screens/components.md](screens/components.md) |
| 9d | 閲覧履歴: ユーザーあたりの保持件数の上限と超過分の削除方式（挿入時トリミング / 定期ジョブ）、履歴からの個別削除（スワイプ削除等）を入れるか、記録トリガーは「詳細を開いたときのみ」で確定 | Phase 4 | [features/view-history.md](features/view-history.md) |
| 10 | カウント列キャッシュ: 補正ジョブの実行頻度、サーバー側リトライの上限回数。補正ジョブは cron 起動の管理 CLI コマンド（MVP。[processing-model.md](processing-model.md) §8）。アカウント削除時は削除トランザクション内で生き残る他ユーザー・他レシピのカウントを減算する（確定）。実装方法の詳細は Phase で詰める | Phase 5〜 | [non-functional.md](non-functional.md), [processing-model.md](processing-model.md), [features/profile.md](features/profile.md), [features/follow.md](features/follow.md) |
| 11 | 自分の非公開レシピを自分でお気に入り → **可（確定）**。実装で漏れないよう受け入れ基準化 | Phase 6 | [features/favorite.md](features/favorite.md) |
| 12 | 感想: 退会ユーザーの感想の扱い（現状 CASCADE 削除。「退会したユーザー」表示で残す案の是非） | Phase 7 | [features/comment.md](features/comment.md) |
| 13 | 感想: レシピ投稿者による削除時に投稿者へ通知するか、非表示 / 完全削除どちらか | Phase 7 | [features/comment.md](features/comment.md) |
| 14 | SNS リンクの URL 検証をどこまで厳格にするか（形式のみ / ドメイン許可リスト） | Phase 5 | [features/profile.md](features/profile.md) |
| 15 | アバターのデフォルト画像・トリミング UI の仕様、一時アップロード画像の GC 猶予時間 | Phase 3 / Phase 5 | [features/profile.md](features/profile.md), [features/image.md](features/image.md) |
| 16 | 認証: パスワード強度ルール、秘密の答えの正規化仕様、リセットの試行回数ロック閾値 / ロック時間、秘密の質問方式で未登録メールに決定的なダミー質問文を返すデコイ方式（メールのハッシュから固定候補集合を選ぶ）の採否（完全な存在秘匿は将来のメールベース方式で対応）、リフレッシュトークン有効期限（保持 ON / OFF での差）、応答取りこぼし時の再ログインが問題になる場合のリクエストバインド冪等キー（クライアント生成の nonce）方式の採否 | Phase 1 | [features/auth.md](features/auth.md), [data-model.md](data-model.md), [non-functional.md](non-functional.md) |
| 17 | 秘密の質問・答えの後からの変更手段（プロフィール編集に入れるか） | MVP 完了後 | [features/auth.md](features/auth.md), [features/profile.md](features/profile.md) |
| 18 | 通知: fan-out（`followee_new_recipe`）は**公開レシピ作成トランザクション内で `notification_outbox` に 1 行 → コミット後に `BackgroundTasks` が配布 → 落ちた分は定期スイープが回収**に確定（[processing-model.md](processing-model.md) §3・§7・§9）。単一行の通知は発火元と同一トランザクション。**残**: `notifications` / `notification_outbox` の物理スキーマと重複防止の一意制約の形（Phase 8）、outbox スイープの間隔、通知・処理済み outbox の保持期間、大量フォロワー時の性能測定と専用ジョブキュー（arq / Celery + Redis）導入の判断（Phase 10 以降）、まとめ表示、非公開化での通知取り消し | Phase 8 / Phase 10 | [features/notification.md](features/notification.md), [processing-model.md](processing-model.md) |
| 19 | `PUT /recipes` 時の画像キー省略 / `null` の意味は定義済み。サムネイルは省略 = 変更なし、`null` = 削除。全入れ替えの手順は既存キー再送 = 維持、省略 / `null` = 画像なし | 定義済み（Phase 3 で実装） | [features/recipe.md](features/recipe.md), [features/image.md](features/image.md) |
| 21 | 材料・手順の並べ替え UI（ドラッグ / 上下ボタン）の確定 | Phase 2 | [features/recipe.md](features/recipe.md) |
| 22 | メールアドレス変更フロー（再確認メール） | MVP 完了後 | [features/auth.md](features/auth.md) |
| 23 | いいね（お気に入りと別の反応）、感想への返信、タグ / カテゴリ、通報 / NG ワードの優先順位 | MVP 完了後 | [overview.md](overview.md) |
| 24 | 学習用引き渡し資料（React Native / Expo / FastAPI / SQLModel / Alembic、随時トラック用に Compose Multiplatform）を `learning-handover` で作成（後日学習用、非ブロッキング） | 実装着手前に別タスク | [tech-stack.md](tech-stack.md) |
| 25 | ブラウザ（Web）単体配信の採否と時期（TS トラックの RN Web ビルド／将来の Compose for Web / Wasm） | MVP 完了後 | [tech-stack.md](tech-stack.md) |
| 26 | デスクトップの最小 OS バージョン、ウィンドウ最小サイズ、ボトムバー ⇔ ナビゲーションレールの切替ブレークポイント、レスポンシブ / 2 ペイン表示（一覧＋詳細の横並び） | Phase 0 / 各フェーズ | [screens/navigation.md](screens/navigation.md) |
| 27 | プラットフォーム固有機能の洗い出し（画像ピッカー、カメラ、セキュアストレージ、共有 等）。**TS トラック**は Expo モジュール ＋ Tauri プラグインで吸収（`expect`/`actual` は使わない）。**Kotlin トラック**は `expect`/`actual` で Desktop 実装 | Phase 0 | [architecture.md](architecture.md), [tech-stack.md](tech-stack.md) |
| 28 | Desktop のセキュアストレージ（リフレッシュトークン永続化。OS クレデンシャルストアが使えない場合の暗号化方式） | Phase 1 | [non-functional.md](non-functional.md) |
| 29 | `prefix` 単位をユーザーが増やせるようにするか、`カップ` の配置（`1 カップ` / `カップ 1`）、単位と数量の間のスペース有無 | Phase 2 | [features/unit.md](features/unit.md) |
| 30 | 画像のみ（本文なし）の感想を許すか。`PATCH /comments` の `imageKey` 省略 / `null` の意味は定義済み | Phase 7 | [features/comment.md](features/comment.md), [features/image.md](features/image.md) |
| 31 | デスクトップアプリの配布方法・コード署名（署名なしは OS 警告が出る。証明書は有料）。課題提出時は署名不要 | Phase 10 | [tech-stack.md](tech-stack.md) |
| 32 | 一時アップロード画像は所有者と参照先を保持し、本人所有かつ「未使用または更新対象自身に紐付け済み」を許可する要件まで定義済み。`uploads` テーブルと**ストレージ削除キュー**（`pending_storage_deletions` 等。[processing-model.md](processing-model.md) §9）の具体的な物理スキーマを Phase 3 で確定 | 定義済み（物理スキーマは Phase 3） | [data-model.md](data-model.md), [processing-model.md](processing-model.md), [features/image.md](features/image.md) |
| 33 | 外部ディープリンク（URL スキーム / ユニバーサルリンク）の採否 | MVP 完了後 | [screens/navigation.md](screens/navigation.md) |
| 34 | 通知バッジの更新方式（他 destination 滞在中に `unread-count` をポーリングするか、間隔） | Phase 8 | [screens/notifications.md](screens/notifications.md) |
| 35 | レシピ作成画面をデスクトップでフルスクリーンダイアログにするか、大きめダイアログにするか | Phase 2 | [screens/recipe-editor.md](screens/recipe-editor.md) |
| 36 | 破壊的操作の取り消し（Undo スナックバー）を入れるか | MVP 完了後 | [screens/components.md](screens/components.md) |
| 37 | 材料グループ: グループ数・グループあたり材料数の上限、名前なしグループが複数あるときの詳細表示（見出しなしで連結 / 区切り線） | Phase 2 | [features/recipe.md](features/recipe.md) |
| 38 | 材料のレシピ参照: 「レシピから選ぶ」ピッカーの UI 詳細（一覧 / 検索 / 最近作ったもの）、循環参照（A↔B）の表示上の扱い、`ingredient_groups.name` / `ref_recipe_title` を検索対象に含めるか | Phase 2 / Phase 4 | [features/recipe.md](features/recipe.md), [features/search.md](features/search.md) |
| 39 | パッケージ管理: まず venv + pip + requirements.txt で進め、その後 `uv` に置き換えて何が変わるか比較・検証する（学習後） | Phase 0 後の学習 | [tech-stack.md](tech-stack.md) |
| 40 | 本番 ASGI 実行構成の確定（Uvicorn workers / Gunicorn + Uvicorn worker / Granian）、ワーカー数、リバースプロキシ | Phase 10 前後 | [tech-stack.md](tech-stack.md), [architecture.md](architecture.md) |
| 41 | JWT ライブラリの最終確定（PyJWT / Authlib。python-jose はメンテ停滞のため回避）、Bearer 認証依存性の実装詳細（JSON ログインエンドポイントと組み合わせる） | Phase 1 | [tech-stack.md](tech-stack.md), [features/auth.md](features/auth.md) |
| 42 | OpenAPI コード生成の運用: **Kotlin** = OpenAPI Generator のジェネレータ選定（`kotlin` + Ktor Client / `kotlin-multiplatform`）、生成物は `shared`。**TS** = openapi-typescript + openapi-fetch（採用済み）の生成スクリプト、生成物は `expoApp`。CI での `openapi.json` 再生成と生成物の差分チェック（契約テスト）は [testing.md](testing.md) §1・§5（`contract.yml`）で確定。Kotlin 側の運用は frontend-kotlin 着手時 | Phase 0 / 各フェーズ | [testing.md](testing.md), [tech-stack.md](tech-stack.md), [architecture.md](architecture.md) |
| 46 | TS トラック: RN Web ビルドを Tauri 2 で包む構成の詳細（ビルドパイプライン、カメラ = getUserMedia / Tauri プラグイン、デスクトップのセキュアストレージ = keyring / Stronghold、ウィンドウ設定） | Phase 0 / Phase 1 / Phase 3 | [tech-stack.md](tech-stack.md), [architecture.md](architecture.md) |
| 47 | TS トラック: ビルド / 配布方式（EAS Build クラウド vs ローカルビルド、Tauri の `.msi` / `.dmg` 生成、署名は課題提出時は不要） | Phase 0 / Phase 10 | [tech-stack.md](tech-stack.md) |
| 48 | TS トラック: NativeWind（採用済み）の運用詳細 — デザイントークン、ダークモード対応、共通コンポーネントのスタイル方針 | Phase 0 / Phase 4 | [tech-stack.md](tech-stack.md), [screens/components.md](screens/components.md) |
| 43 | SQLModel のモデル定義で表現できない DB 制約（複合外部キー・部分インデックス・`CHECK`・トリガー）を Alembic の手書きマイグレーションで補う運用の詳細、Alembic autogenerate と手書きの併用方針 | Phase 0 / 各フェーズ | [data-model.md](data-model.md), [tech-stack.md](tech-stack.md) |
| 44 | 構造化ログの実現手段（標準 `logging` の JSON フォーマッタ / `structlog`）、リクエスト ID の付与方式（ミドルウェア）。**Phase 0 の backend scaffold で雛形を入れる** | Phase 0 / Phase 10 | [non-functional.md](non-functional.md) |
| 51 | テスト / CI: ツールは確定（[testing.md](testing.md)）。**未定**: 各ツールのバージョン（Phase 0 で固定）、カバレッジ下限の最終値、E2E を CI でどのプラットフォームまで回すか（Android エミュレータ ＋ Web は必須、iOS シミュレータは macOS ランナー要）、`main` のブランチ保護（必須チェック）の有効化 | Phase 0 / 各フェーズ | [testing.md](testing.md) |
| 52 | **Maestro CLI のローカル導入**（E2E をローカルで実行する場合。JDK 25 導入済み。CI は Maestro の setup アクションを使う）。手順は Phase 1 frontend-ts イシューに記載 | Phase 1 前 | [testing.md](testing.md) |
| 45 | **AI 誤字脱字チェック（Phase 11）の spike**: プロバイダ構成は確定（`AI_PROVIDER` = local(dev) / anthropic(prod・Claude Haiku 第一候補) / stub(test)、`/api/v1/ai/` 名前空間）。**未確定**: dev のローカルモデル選定（Ollama モデル / HuggingFace 日本語 GEC / llama-cpp）と実行方式（compose の `ollama` サービス vs in-process）とリソース要件、production のモデル・モデルバージョン、校正プロンプト設計・`note` の要否、レート制限の閾値・`ai_usage` テーブルの要否・コスト予算、対象フィールドの追加検討（タイトル・説明・手順本文・材料名は確定。材料グループ名を含めるかは未確定）、ストリーミング応答・キャッシュの要否、dev / prod で校正結果が変わることの許容範囲 | Phase 11 着手前 | [features/ai-proofread.md](features/ai-proofread.md), [tech-stack.md](tech-stack.md) |
| 45b | 他の AI 機能（レシピ画像からの材料・料理名認識など）。同じ `/api/v1/ai/` 名前空間・`app/ai/` に載せる。推論方式・コスト・レイテンシ | MVP 完了後 | [tech-stack.md](tech-stack.md), [overview.md](overview.md) |
| 50 | **処理方式の実行基盤**（[processing-model.md](processing-model.md)）: 即時後処理は FastAPI `BackgroundTasks`・定期処理は cron 起動の管理 CLI コマンドで確定。**未定**: 本番のスケジューラの具体（OS cron / コンテナオーケストレータの CronJob 等）と多重起動防止、各定期バッチ（カウント補正 / 一時アップロード GC / ストレージ削除 / 期限切れリフレッシュトークン掃除 / 古い通知掃除 / 閲覧履歴トリミング）の実行頻度、期限切れリフレッシュトークン・通知の保持期間、専用ジョブキュー（arq / Celery + Redis）へ移行する判断基準（大量フォロワー時の fan-out 性能測定） | Phase 0（土台）/ Phase 3・8（各ジョブ）/ Phase 10（仕上げ・キュー再検討） | [processing-model.md](processing-model.md), [architecture.md](architecture.md), [non-functional.md](non-functional.md) |

## 決定済み（対象外で確定）

- **MVP の線引き — 候補 B / Phase 4 まで**に確定（2026-09-02。認証・レシピ CRUD・画像・ナビ・ホーム「全体」フィード・検索・閲覧履歴。ソーシャルは MVP 後、AI は MVP 対象外。[roadmap.md](roadmap.md) 「MVP ライン」）
- ブロック機能・フォロー承認制 — 不要
- 画像カルーセル — 廃止（サムネイル + 手順画像に統合）
- プッシュ通知・メール通知 — 対象外（アプリ内通知のみ）
- ブラウザ（Web）単体配信 — 当面対象外（デスクトップアプリで対応）
- 技術スタック — フロント: **2 トラック**。(A) TypeScript + React Native + **Expo SDK 57 / RN 0.86** + Node 24（必須。Desktop は Tauri 2）、(B) Kotlin Multiplatform + Compose（随時・非ブロッキング）。バックエンド: Python 3.14.7 + FastAPI + SQLModel + Alembic（AI 認識機能の学習目的）。いずれも 1 本の FastAPI を OpenAPI 契約で叩く。型共有は OpenAPI 3.1 →（Kotlin: OpenAPI Generator ／ TS: openapi-typescript）。`resolve-tech-stack` で確認済み（環境チェック 2026-09-01）

> このリストはレビューで随時追加する。
