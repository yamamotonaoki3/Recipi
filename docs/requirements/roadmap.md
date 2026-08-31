# 開発ロードマップ / MVP 候補ライン

機能を Phase に分ける。各 Phase は **backend → frontend の順**（CLAUDE.md「Issue駆動・複数Issue自動連続実行ルール」に従い、フロントは対応するバックエンド PR がマージ・動作確認済みになるまで着手しない）。各 Phase を backend / frontend 別 Issue に分割する。

| Phase | 内容 | 関連ドキュメント |
| --- | --- | --- |
| Phase 0 | scaffold（Gradle マルチモジュール、`shared` / `composeApp`（android/ios/**desktop**）/ `desktopApp` 雛形、Docker Compose、CI 雛形、`.env.example`） | [architecture.md](architecture.md) |
| Phase 1 | 認証: signup（秘密の質問含む）/ login /「ログインを保持」/ アクセス＋リフレッシュトークン（ローテーション）/ `/auth/refresh` / `/auth/logout` / パスワードリセット ＋ ログイン / サインアップ / パスワードリセット画面 ＋ プロフィール編集（表示名のみ） | [features/auth.md](features/auth.md), [features/profile.md](features/profile.md) |
| Phase 2 | レシピ CRUD（画像なし）＋ 単位マスター（`placement` 含む）・`GET /units`・単位の表示整形ロジック（`shared`）・作成編集画面の行編集 UX | [features/recipe.md](features/recipe.md), [features/unit.md](features/unit.md) |
| Phase 3 | 画像: `POST /images`（一時アップロード）＋ レシピのサムネイル ＋ 手順ごとの画像（`recipe_images` は無し。感想画像は Phase 7） | [features/image.md](features/image.md) |
| Phase 4 | ボトムナビゲーション / ナビゲーションレール ＋ ホーム「全体」タブ ＋ 検索 destination（`q`、スペース分割・正規化） | [screens/navigation.md](screens/navigation.md), [features/home-feed.md](features/home-feed.md), [features/search.md](features/search.md) |
| Phase 5 | フォロー / フォロワー（`follows`、フォロー API、**カウント列キャッシュ**、ユーザープロフィール、フォロー・フォロワー 2 タブ画面）＋ ホーム「フォロー」「フォロワー」タブ ＋ プロフィール拡張（アバター・SNS リンク・公開トグル） | [features/follow.md](features/follow.md), [features/profile.md](features/profile.md), [features/image.md](features/image.md) |
| Phase 6 | お気に入り（`favorites`、♡ API、`recipes.favorite_count`、ホーム「お気に入りレシピ」タブ、自分の非公開レシピ可） | [features/favorite.md](features/favorite.md) |
| Phase 7 | 感想（コメント）（`recipe_comments`、コメント API、`recipes.comment_count`、**感想画像**、レシピ詳細の感想セクション、無限スクロール） | [features/comment.md](features/comment.md), [features/image.md](features/image.md) |
| Phase 8 | 通知（`notifications`、通知タブのバッジ、通知一覧、4 種のイベント生成・fan-out） | [features/notification.md](features/notification.md) |
| Phase 9 | アカウント削除（`DELETE /users/me`、CASCADE、確認 UI） | [features/profile.md](features/profile.md) |
| Phase 10 | 仕上げ（バリデーション強化、エラー UX、空状態、カウント補正ジョブ、E2E 動作確認、デスクトップ配布パッケージ） | 全体 |

各フェーズのフロント Issue では **Android / iOS / Desktop の 3 プラットフォームで動作確認**する。

## MVP 候補ライン（未確定）

初回リリースをどこで切るかの候補。ユーザーと決定する。

- **候補 A: Phase 3 まで** — 登録・共有・画像。ソーシャル要素なし。最小
- **候補 B: Phase 4 まで** — ＋ ホーム「全体」＋ 検索
- **候補 C: Phase 7 まで** — ＋ フォロー / お気に入り / 感想（4 タブ + ソーシャル）
- **候補 D: Phase 10 まで（全部）** — 通知・アカウント削除まで含む

→ この決定は [todo.md](todo.md) の最上位項目。
