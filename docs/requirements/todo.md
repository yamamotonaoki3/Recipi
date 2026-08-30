# 未確定事項 / 要調査（TODO）

| # | 項目 | 対応時期 | 関連 |
| --- | --- | --- | --- |
| 1 | **MVP の線引き**（[roadmap.md](roadmap.md) の候補ラインから決定） | 最優先・本書レビュー後 | [roadmap.md](roadmap.md) |
| 2 | 本番デプロイ先（Fly.io / Render / AWS 等）の選定 | Phase 10 前後 | [architecture.md](architecture.md) |
| 3 | iOS ビルドに必要な macOS / Xcode 環境の有無・調達 | Phase 0 | [tech-stack.md](tech-stack.md) |
| 4 | Compose Multiplatform の画像ピッカー / カメラ / 画像トリミングライブラリの具体選定 | Phase 3 / Phase 5 | [features/image.md](features/image.md) |
| 5 | PostgreSQL・各ライブラリのバージョン確定（`resolve-tech-stack`）、このマシンでの利用可否検査 | 実装着手前 | [tech-stack.md](tech-stack.md) |
| 6 | Android minSdk / iOS 対応下限の確定 | Phase 0 | [non-functional.md](non-functional.md) |
| 7 | フロントの状態管理 / DI / ナビゲーションライブラリの選定 | Phase 0 | [tech-stack.md](tech-stack.md) |
| 8 | S3 互換ストレージの本番サービス選定（R2 / S3 等）、署名付き URL か公開バケットか | Phase 3〜10 | [features/image.md](features/image.md) |
| 9 | 検索: `pg_trgm` 拡張の採否、`title_normalized` / `name_normalized` の正規化仕様（かな / カナ・送り仮名ゆれをどこまで吸収するか）、`q` の語数・長さ上限 | Phase 4 | [features/search.md](features/search.md) |
| 10 | カウント列キャッシュ: 補正ジョブの実行頻度、サーバー側リトライの上限回数、アカウント削除時に他ユーザーのカウントを減算するか補正ジョブに任せるか | Phase 5〜 | [non-functional.md](non-functional.md), [features/follow.md](features/follow.md) |
| 11 | 自分の非公開レシピを自分でお気に入り → **可（確定）**。実装で漏れないよう受け入れ基準化 | Phase 6 | [features/favorite.md](features/favorite.md) |
| 12 | 感想: 退会ユーザーの感想の扱い（現状 CASCADE 削除。「退会したユーザー」表示で残す案の是非） | Phase 7 | [features/comment.md](features/comment.md) |
| 13 | 感想: レシピ投稿者による削除時に投稿者へ通知するか、非表示 / 完全削除どちらか | Phase 7 | [features/comment.md](features/comment.md) |
| 14 | SNS リンクの URL 検証をどこまで厳格にするか（形式のみ / ドメイン許可リスト） | Phase 5 | [features/profile.md](features/profile.md) |
| 15 | アバターのデフォルト画像・トリミング UI の仕様、一時アップロード画像の GC 猶予時間 | Phase 3 / Phase 5 | [features/profile.md](features/profile.md), [features/image.md](features/image.md) |
| 16 | 認証: パスワード強度ルール、秘密の答えの正規化仕様、リセットの試行回数ロック閾値 / ロック時間、未登録メールでのユーザー存在秘匿方針、リフレッシュトークン有効期限（保持 ON / OFF での差） | Phase 1 | [features/auth.md](features/auth.md) |
| 17 | 秘密の質問・答えの後からの変更手段（プロフィール編集に入れるか） | MVP 完了後 | [features/auth.md](features/auth.md), [features/profile.md](features/profile.md) |
| 18 | 通知: fan-out の実装方式（同期 INSERT / 非同期ジョブ / キュー）、大量フォロワー時の性能、通知の保持期間・自動削除、まとめ表示、お気に入り解除 / 非公開化での通知取り消し、レシピの公開化で `followee_new_recipe` を出すか | Phase 8 | [features/notification.md](features/notification.md) |
| 19 | `PUT /recipes` 時の画像キー省略 / `null` の意味（変更なし / 削除） | Phase 3 | [features/recipe.md](features/recipe.md) |
| 20 | ホームの「お気に入りレシピ」タブと検索（`q`）の併用可否 | Phase 6 | [features/home-feed.md](features/home-feed.md) |
| 21 | 材料・手順の並べ替え UI（ドラッグ / 上下ボタン）の確定 | Phase 2 | [features/recipe.md](features/recipe.md) |
| 22 | メールアドレス変更フロー（再確認メール） | MVP 完了後 | [features/auth.md](features/auth.md) |
| 23 | いいね（お気に入りと別の反応）、感想への返信、タグ / カテゴリ、通報 / NG ワードの優先順位 | MVP 完了後 | [overview.md](overview.md) |
| 24 | 学習用引き渡し資料（Ktor / Exposed / Compose Multiplatform）を `learning-handover` で作成（後日学習用、非ブロッキング） | 実装着手前に別タスク | [tech-stack.md](tech-stack.md) |
| 25 | ブラウザ（Web）版（Compose for Web / Wasm）の採否と時期 | MVP 完了後 | [tech-stack.md](tech-stack.md) |
| 26 | デスクトップの最小 OS バージョン、ウィンドウ最小サイズ、レスポンシブ / 2 ペイン表示（一覧＋詳細の横並び） | Phase 0 / 各フェーズ | [screens.md](screens.md) |
| 27 | `expect` / `actual` で吸収するプラットフォーム固有機能の洗い出し（画像ピッカー、カメラ、セキュアストレージ、共有 等）と Desktop 実装 | Phase 0 | [architecture.md](architecture.md), [tech-stack.md](tech-stack.md) |
| 28 | Desktop のセキュアストレージ（リフレッシュトークン永続化。OS クレデンシャルストアが使えない場合の暗号化方式） | Phase 1 | [non-functional.md](non-functional.md) |
| 29 | `prefix` 単位をユーザーが増やせるようにするか、`カップ` の配置（`1 カップ` / `カップ 1`）、単位と数量の間のスペース有無 | Phase 2 | [features/unit.md](features/unit.md) |
| 30 | 画像のみ（本文なし）の感想を許すか、`PATCH /comments` の `imageKey` 省略 / `null` の意味 | Phase 7 | [features/comment.md](features/comment.md) |
| 31 | デスクトップアプリの配布方法・コード署名（署名なしは OS 警告が出る。証明書は有料）。課題提出時は署名不要 | Phase 10 | [tech-stack.md](tech-stack.md) |

## 決定済み（対象外で確定）

- ブロック機能・フォロー承認制 — 不要
- 画像カルーセル — 廃止（サムネイル + 手順画像に統合）
- プッシュ通知・メール通知 — 対象外（アプリ内通知のみ）
- ブラウザ（Web）版 — 当面対象外（デスクトップアプリで対応。将来 Compose for Web を検討）
- 技術スタック — Kotlin Multiplatform + Compose Multiplatform（Android / iOS / Desktop）+ Ktor で確定

> このリストはレビューで随時追加する。
