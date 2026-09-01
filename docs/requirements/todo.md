# 未確定事項 / 要調査（TODO）

| # | 項目 | 対応時期 | 関連 |
| --- | --- | --- | --- |
| 1 | **MVP の線引き**（[roadmap.md](roadmap.md) の候補ラインから決定） | 最優先・本書レビュー後 | [roadmap.md](roadmap.md) |
| 2 | 本番デプロイ先（Fly.io / Render / AWS 等）の選定 | Phase 10 前後 | [architecture.md](architecture.md) |
| 3 | iOS ビルドに必要な macOS / Xcode 環境の有無・調達 | Phase 0 | [tech-stack.md](tech-stack.md) |
| 4 | 画像ピッカー / カメラ / トリミングの具体選定。**TS トラック**: `expo-image-picker` / `expo-camera` / `expo-image-manipulator`、デスクトップ（Tauri）は getUserMedia / ファイル選択。**Kotlin トラック**: KMP 対応ライブラリ | Phase 3 / Phase 5 | [features/image.md](features/image.md) |
| 5 | PostgreSQL メジャーバージョン・フロント / バックの各ライブラリのバージョン確定（`resolve-tech-stack`）、このマシンでの利用可否検査。Python は 3.14.7 で固定（`.python-version` = 3.14.7 / `requires-python = ">=3.14,<3.15"` / `python:3.14.7-slim`）、backend の C 拡張ライブラリの Windows wheel は 3.14.7 で確認済み。**TS トラック**: Node / Expo SDK / React Native / Tauri のバージョン確定とこのマシンでの利用可否（Node・Rust ツールチェーン） | 実装着手前 | [tech-stack.md](tech-stack.md) |
| 6 | Android minSdk / iOS 対応下限の確定 | Phase 0 | [non-functional.md](non-functional.md) |
| 7 | フロントの状態管理 / DI / ナビゲーションライブラリの選定。**TS**: クライアント状態ライブラリの選定（Zustand / Jotai）、TanStack Query（採用済み）のキャッシュ / 無効化方針、Expo Router の運用。**Kotlin**: ViewModel / Koin / Compose Navigation 等 | Phase 0 | [tech-stack.md](tech-stack.md) |
| 8 | S3 互換ストレージの本番サービス選定（R2 / S3 等）、署名付き URL か公開バケットか | Phase 3〜10 | [features/image.md](features/image.md) |
| 9 | 検索: `pg_trgm` 拡張の採否、`title_normalized` / `name_normalized` の正規化仕様（かな / カナ・送り仮名ゆれをどこまで吸収するか）、`q` の語数・長さ上限 | Phase 4 | [features/search.md](features/search.md) |
| 10 | カウント列キャッシュ: 補正ジョブの実行頻度、サーバー側リトライの上限回数。アカウント削除時は削除トランザクション内で生き残る他ユーザー・他レシピのカウントを減算する（確定）。実装方法の詳細は Phase で詰める | Phase 5〜 | [non-functional.md](non-functional.md), [features/profile.md](features/profile.md), [features/follow.md](features/follow.md) |
| 11 | 自分の非公開レシピを自分でお気に入り → **可（確定）**。実装で漏れないよう受け入れ基準化 | Phase 6 | [features/favorite.md](features/favorite.md) |
| 12 | 感想: 退会ユーザーの感想の扱い（現状 CASCADE 削除。「退会したユーザー」表示で残す案の是非） | Phase 7 | [features/comment.md](features/comment.md) |
| 13 | 感想: レシピ投稿者による削除時に投稿者へ通知するか、非表示 / 完全削除どちらか | Phase 7 | [features/comment.md](features/comment.md) |
| 14 | SNS リンクの URL 検証をどこまで厳格にするか（形式のみ / ドメイン許可リスト） | Phase 5 | [features/profile.md](features/profile.md) |
| 15 | アバターのデフォルト画像・トリミング UI の仕様、一時アップロード画像の GC 猶予時間 | Phase 3 / Phase 5 | [features/profile.md](features/profile.md), [features/image.md](features/image.md) |
| 16 | 認証: パスワード強度ルール、秘密の答えの正規化仕様、リセットの試行回数ロック閾値 / ロック時間、秘密の質問方式で未登録メールに決定的なダミー質問文を返すデコイ方式（メールのハッシュから固定候補集合を選ぶ）の採否（完全な存在秘匿は将来のメールベース方式で対応）、リフレッシュトークン有効期限（保持 ON / OFF での差）、応答取りこぼし時の再ログインが問題になる場合のリクエストバインド冪等キー（クライアント生成の nonce）方式の採否 | Phase 1 | [features/auth.md](features/auth.md), [data-model.md](data-model.md), [non-functional.md](non-functional.md) |
| 17 | 秘密の質問・答えの後からの変更手段（プロフィール編集に入れるか） | MVP 完了後 | [features/auth.md](features/auth.md), [features/profile.md](features/profile.md) |
| 18 | 通知: fan-out の実装方式（同期 INSERT / 非同期ジョブ / キュー）、大量フォロワー時の性能、通知の保持期間・自動削除、まとめ表示、非公開化での通知取り消し | Phase 8 | [features/notification.md](features/notification.md) |
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
| 32 | 一時アップロード画像は所有者と参照先を保持し、本人所有かつ「未使用または更新対象自身に紐付け済み」を許可する要件まで定義済み。`uploads` テーブル等の具体的な物理スキーマを Phase 3 で確定 | 定義済み（物理スキーマは Phase 3） | [data-model.md](data-model.md), [features/image.md](features/image.md) |
| 33 | 外部ディープリンク（URL スキーム / ユニバーサルリンク）の採否 | MVP 完了後 | [screens/navigation.md](screens/navigation.md) |
| 34 | 通知バッジの更新方式（他 destination 滞在中に `unread-count` をポーリングするか、間隔） | Phase 8 | [screens/notifications.md](screens/notifications.md) |
| 35 | レシピ作成画面をデスクトップでフルスクリーンダイアログにするか、大きめダイアログにするか | Phase 2 | [screens/recipe-editor.md](screens/recipe-editor.md) |
| 36 | 破壊的操作の取り消し（Undo スナックバー）を入れるか | MVP 完了後 | [screens/components.md](screens/components.md) |
| 37 | 材料グループ: グループ数・グループあたり材料数の上限、名前なしグループが複数あるときの詳細表示（見出しなしで連結 / 区切り線） | Phase 2 | [features/recipe.md](features/recipe.md) |
| 38 | 材料のレシピ参照: 「レシピから選ぶ」ピッカーの UI 詳細（一覧 / 検索 / 最近作ったもの）、循環参照（A↔B）の表示上の扱い、`ingredient_groups.name` / `ref_recipe_title` を検索対象に含めるか | Phase 2 / Phase 4 | [features/recipe.md](features/recipe.md), [features/search.md](features/search.md) |
| 39 | パッケージ管理: まず venv + pip + requirements.txt で進め、その後 `uv` に置き換えて何が変わるか比較・検証する（学習後） | Phase 0 後の学習 | [tech-stack.md](tech-stack.md) |
| 40 | 本番 ASGI 実行構成の確定（Uvicorn workers / Gunicorn + Uvicorn worker / Granian）、ワーカー数、リバースプロキシ | Phase 10 前後 | [tech-stack.md](tech-stack.md), [architecture.md](architecture.md) |
| 41 | JWT ライブラリの最終確定（PyJWT / Authlib。python-jose はメンテ停滞のため回避）、Bearer 認証依存性の実装詳細（JSON ログインエンドポイントと組み合わせる） | Phase 1 | [tech-stack.md](tech-stack.md), [features/auth.md](features/auth.md) |
| 42 | OpenAPI コード生成の運用: **Kotlin** = OpenAPI Generator のジェネレータ選定（`kotlin` + Ktor Client / `kotlin-multiplatform`）、生成物は `shared`。**TS** = openapi-typescript + openapi-fetch（採用済み）の生成スクリプト、生成物は `expoApp`。CI での `openapi.json` 再生成と両生成物の差分チェックの仕組み | Phase 0 / 各フェーズ | [tech-stack.md](tech-stack.md), [architecture.md](architecture.md) |
| 46 | TS トラック: RN Web ビルドを Tauri 2 で包む構成の詳細（ビルドパイプライン、カメラ = getUserMedia / Tauri プラグイン、デスクトップのセキュアストレージ = keyring / Stronghold、ウィンドウ設定） | Phase 0 / Phase 1 / Phase 3 | [tech-stack.md](tech-stack.md), [architecture.md](architecture.md) |
| 47 | TS トラック: ビルド / 配布方式（EAS Build クラウド vs ローカルビルド、Tauri の `.msi` / `.dmg` 生成、署名は課題提出時は不要） | Phase 0 / Phase 10 | [tech-stack.md](tech-stack.md) |
| 48 | TS トラック: NativeWind（採用済み）の運用詳細 — デザイントークン、ダークモード対応、共通コンポーネントのスタイル方針 | Phase 0 / Phase 4 | [tech-stack.md](tech-stack.md), [screens/components.md](screens/components.md) |
| 43 | SQLModel のモデル定義で表現できない DB 制約（複合外部キー・部分インデックス・`CHECK`・トリガー）を Alembic の手書きマイグレーションで補う運用の詳細、Alembic autogenerate と手書きの併用方針 | Phase 0 / 各フェーズ | [data-model.md](data-model.md), [tech-stack.md](tech-stack.md) |
| 44 | 構造化ログの実現手段（標準 `logging` の JSON フォーマッタ / `structlog`）、リクエスト ID の付与方式（ミドルウェア） | Phase 0 / Phase 10 | [non-functional.md](non-functional.md) |
| 45 | AI 認識機能: モデルの提供方式（クラウド API / ローカル推論）、対象タスク（レシピ画像からの材料・料理名認識など）、`/api/v1/ai/...` 名前空間、推論のコスト / レイテンシ | MVP 完了後 | [tech-stack.md](tech-stack.md), [overview.md](overview.md) |

## 決定済み（対象外で確定）

- ブロック機能・フォロー承認制 — 不要
- 画像カルーセル — 廃止（サムネイル + 手順画像に統合）
- プッシュ通知・メール通知 — 対象外（アプリ内通知のみ）
- ブラウザ（Web）単体配信 — 当面対象外（デスクトップアプリで対応）
- 技術スタック — フロント: **2 トラック**。(A) TypeScript + React Native + Expo（必須。Desktop は Tauri 2）、(B) Kotlin Multiplatform + Compose（随時・非ブロッキング）。バックエンド: Python + FastAPI + SQLModel + Alembic（AI 認識機能の学習目的）。いずれも 1 本の FastAPI を OpenAPI 契約で叩く。型共有は OpenAPI 3.1 →（Kotlin: OpenAPI Generator ／ TS: openapi-typescript）。`resolve-tech-stack` で確認済み

> このリストはレビューで随時追加する。
