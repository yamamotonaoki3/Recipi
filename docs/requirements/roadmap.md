# 開発ロードマップ / MVP 候補ライン

機能を Phase に分ける。各 Phase は **backend → frontend の順**（CLAUDE.md「Issue駆動・複数Issue自動連続実行ルール」に従い、フロントは対応するバックエンド PR がマージ・動作確認済みになるまで着手しない）。

- 各 Phase の Issue は **backend / frontend-ts / frontend-kotlin の 3 系統**に分割する。
- **frontend-ts（TypeScript / Expo）が必須トラック**。**frontend-kotlin（KMP / Compose）は随時・非ブロッキング**で、自動連続実行の完了判定には含めない（[tech-stack.md](tech-stack.md) / root CLAUDE.md）。
- backend は Python（FastAPI / SQLModel / Alembic）で実装する（[tech-stack.md](tech-stack.md)）。
- 各 backend Phase の完了時に `openapi.json` を更新し、対応する frontend Phase の冒頭で API クライアントを再生成する（TS: openapi-typescript、Kotlin: OpenAPI Generator。[architecture.md](architecture.md)）。

| Phase | 内容 | 関連ドキュメント |
| --- | --- | --- |
| Phase 0（backend） | scaffold: FastAPI プロジェクト雛形（`app/`）、venv + pip + requirements.txt、Alembic 初期化、Docker Compose（api + postgres + minio）、`.env.development.example` ほか、CI 雛形 | [architecture.md](architecture.md), [tech-stack.md](tech-stack.md) |
| Phase 0（frontend-ts） | scaffold: `expoApp` 雛形（Expo / Expo Router / NativeWind）、openapi-typescript + openapi-fetch の生成設定、TanStack Query、Tauri 2 デスクトップシェル雛形（RN Web ビルド読み込み）、EAS / ローカルビルド方針、CI 雛形 | [architecture.md](architecture.md), [tech-stack.md](tech-stack.md) |
| Phase 0（frontend-kotlin）※随時 | scaffold: Gradle マルチモジュール、`shared` / `composeApp`（android/ios/**desktop**）/ `desktopApp` 雛形、OpenAPI Generator による Kotlin クライアント生成設定、CI 雛形 | [architecture.md](architecture.md) |
| Phase 1 | 認証: signup（秘密の質問含む）/ login /「ログインを保持」/ アクセス＋リフレッシュトークン（ローテーション）/ `/auth/refresh` / `/auth/logout` / パスワードリセット ＋ ログイン / サインアップ / パスワードリセット画面 ＋ プロフィール編集（表示名のみ） | [features/auth.md](features/auth.md), [features/profile.md](features/profile.md) |
| Phase 2 | レシピ CRUD（画像なし）＋ **材料グループ（`ingredient_groups`）・材料のレシピ参照（`ref_recipe_id`）**＋ 単位マスター（`placement` 含む）・`GET /units`・単位の表示整形ロジック（各クライアント）・作成編集画面の行編集 UX | [features/recipe.md](features/recipe.md), [features/unit.md](features/unit.md) |
| Phase 3 | 画像: `POST /images`（一時アップロード）＋ レシピのサムネイル ＋ 手順ごとの画像（`recipe_images` は無し。感想画像は Phase 7） | [features/image.md](features/image.md) |
| Phase 4 | ボトムナビゲーション / ナビゲーションレール（5 destination = ホーム / 履歴 / ＋ / 通知 / マイページ）＋ ホーム「全体」タブ ＋ ホーム上部の常時固定検索窓（`q`、スペース分割・正規化、表示中サブタブ内で絞り込み）＋ **閲覧履歴**（`recipe_views`、`POST /recipes/{id}/view`、`GET`/`DELETE /users/me/history`、「履歴」destination の閲覧履歴画面。レシピ詳細=Phase 2 に依存） | [screens/navigation.md](screens/navigation.md), [screens/home.md](screens/home.md), [screens/history.md](screens/history.md), [features/home-feed.md](features/home-feed.md), [features/search.md](features/search.md), [features/view-history.md](features/view-history.md) |
| Phase 5 | フォロー / フォロワー（`follows`、フォロー API、**カウント列キャッシュ**、ユーザープロフィール、フォロー・フォロワー 2 タブ画面）＋ ホーム「フォロー」「フォロワー」タブ ＋ プロフィール拡張（アバター・SNS リンク・公開トグル） | [features/follow.md](features/follow.md), [features/profile.md](features/profile.md), [features/image.md](features/image.md) |
| Phase 6 | お気に入り（`favorites`、♡ API、`recipes.favorite_count`、ホーム「お気に入りレシピ」タブ、自分の非公開レシピ可） | [features/favorite.md](features/favorite.md) |
| Phase 7 | 感想（コメント）（`recipe_comments`、コメント API、`recipes.comment_count`、**感想画像**、レシピ詳細の感想セクション、無限スクロール） | [features/comment.md](features/comment.md), [features/image.md](features/image.md) |
| Phase 8 | 通知（`notifications`、通知タブのバッジ、通知一覧、4 種のイベント生成・fan-out） | [features/notification.md](features/notification.md) |
| Phase 9 | アカウント削除（`DELETE /users/me`、CASCADE、確認 UI） | [features/profile.md](features/profile.md) |
| Phase 10 | 仕上げ（バリデーション強化、エラー UX、空状態、カウント補正ジョブ、E2E 動作確認、デスクトップ配布パッケージ） | 全体 |
| Phase 11（MVP 対象外） | **AI 誤字脱字チェック**。backend: `app/ai/` の校正サービス抽象 ＋ `local` / `anthropic` / `stub` 実装、`POST /ai/proofread`、レート制限・タイムアウト、`AI_PROVIDER` / `ANTHROPIC_API_KEY`、（dev の実行方式は spike）／ frontend-ts: レシピ編集画面の「AI で誤字脱字チェック」ボタン ＋ 修正案 UI ／ frontend-kotlin 随時。Phase 2（レシピ CRUD）に依存 | [features/ai-proofread.md](features/ai-proofread.md), [tech-stack.md](tech-stack.md), [screens/recipe-editor.md](screens/recipe-editor.md) |

各フェーズのフロント Issue では、そのトラックの対象プラットフォームで動作確認する。**frontend-ts**: iOS / Android / Tauri デスクトップ（Windows・macOS）。**frontend-kotlin**（随時）: Android / iOS / Compose デスクトップ。

## 各 Phase の非同期処理・定期バッチ

処理方式の全体像は [processing-model.md](processing-model.md)。Phase ごとに追加する非同期後処理（`BackgroundTasks`）・定期バッチ（cron 起動の管理 CLI コマンド）:

| Phase | 追加する処理 |
| --- | --- |
| Phase 0（backend） | 管理 CLI コマンドの土台（`backend/` にジョブのエントリポイント）、cron / コンテナスケジューラでの起動方法を scaffold に含める |
| Phase 3（画像） | ストレージ削除キュー（`pending_storage_deletions` 等）＋ ストレージ削除ジョブ、一時アップロード GC の初版 |
| Phase 5（フォロー） | `follows` 分のカウント列補正ジョブ |
| Phase 6（お気に入り） | `favorites` 分のカウント列補正ジョブ |
| Phase 7（感想） | `recipe_comments` 分のカウント列補正ジョブ、感想画像の削除キュー登録（同一トランザクション） |
| Phase 8（通知） | `notifications` ＋ `notification_outbox` テーブル導入。単一行の通知（`followed` / `recipe_favorited` / `recipe_commented`）を発火元（フォロー / お気に入り / 感想の書き込み）と**同一トランザクション**に組み込む。`followee_new_recipe` は outbox 経由で **`BackgroundTasks`** が fan-out ＋ **未処理 outbox の定期スイープ**（取りこぼし回収）。古い通知・処理済み outbox の掃除ジョブ。※ Phase 5〜7 では通知行を作らない（[processing-model.md](processing-model.md) §6 の通知列は Phase 8 で有効化） |
| Phase 9（アカウント削除） | 削除トランザクション内でのカウント補正 ＋ 画像の削除エンキュー |
| Phase 10（仕上げ） | ジョブ実行基盤の仕上げ（cron 設定・多重起動防止・監視）、期限切れリフレッシュトークン掃除、専用ジョブキュー（arq 等）の要否を再検討 |
| Phase 11（AI・MVP 対象外） | `ai_usage` の日次リセット / 集計 |

## MVP 候補ライン（未確定）

初回リリースをどこで切るかの候補。ユーザーと決定する。

- **候補 A: Phase 3 まで** — 登録・共有・画像。ソーシャル要素なし。最小
- **候補 B: Phase 4 まで** — ＋ ホーム「全体」＋ 検索
- **候補 C: Phase 7 まで** — ＋ フォロー / お気に入り / 感想（4 タブ + ソーシャル）
- **候補 D: Phase 10 まで** — 通知・アカウント削除まで含む

- **Phase 11（AI 誤字脱字チェック）はどの候補でも MVP 対象外**。MVP リリース後の追加機能。

→ この決定は [todo.md](todo.md) の最上位項目。
