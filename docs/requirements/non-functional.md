# 非機能要件

## セキュリティ

- 通信は HTTPS 前提（ローカル開発は HTTP 可）。
- パスワード・秘密の質問の答えは Argon2id（`argon2-cffi`）でハッシュ化し、平文・可逆暗号で保存しない。
- 認可チェックはサーバー側で必ず行う:
  - レシピの更新 / 削除 / 画像操作は投稿者本人のみ
  - プロフィール編集・アバター操作・アカウント削除は本人のみ
  - 感想の編集は投稿者本人のみ、削除は感想の投稿者またはレシピの投稿者
  - 通知の既読化は受信者本人のみ

### トークン（[features/auth.md](features/auth.md)）

- **アクセストークンは短命**（例: 15 分）。署名鍵は `.env` 管理。
- アクセストークンは JWT とし、クレームに subject（ユーザー ID）と発行時点の `users.token_version` を含める。JWT の検証は FastAPI の認証依存性（`Depends`）で行い、各リクエストで subject のユーザーの存在と `token_version` の一致を確認し、ユーザー不在または不一致なら 401 を返す。
- パスワードリセット成功時は `users.token_version` を原子的に `+1` し、既発行のアクセストークンを即時無効化する。アカウント削除時も削除前に `+1` することを明示し、将来の全端末ログアウトでも同様に `+1` する。
- **リフレッシュトークンはローテーション方式**: 使用のたびに新しいものを発行し、古いものを即時無効化。
- クライアントはリフレッシュを **single-flight** で行い、同時実行を 1 本に集約して他のリクエストは結果を待つ。これにより、同一リフレッシュトークンの並行リフレッシュは発生しない。
- 消費済み（無効化済み）のリフレッシュトークンが再提示された場合は、例外なくリユースとみなし、そのトークンチェーン全体を失効させて再ログインを要求する。再提示を例外扱いする仕組みは設けない。
- まれにネットワーク障害でリフレッシュ応答を取りこぼした場合は再ログインを必要とする。これが問題になる場合のリクエストバインド冪等キー（クライアント生成の nonce）方式の採否は → [todo.md](todo.md)。
- パスワードリセット成功時は、そのアカウントの全リフレッシュトークン（全チェーン）を失効させる。
- リフレッシュトークン本体はハッシュで `refresh_tokens` に保存し、失効管理する。
- 「ログインを保持」OFF のときは、リフレッシュトークンを端末のセキュアストレージに永続化しない。
- セキュアストレージの実体はプラットフォームごとに実装する（iOS: Keychain、Android: Keystore / EncryptedSharedPreferences、Desktop: OS のクレデンシャルストア。相当機能が無い場合の扱いは → [todo.md](todo.md)）。
  - **TypeScript トラック**: `expo-secure-store`（iOS Keychain / Android Keystore）、デスクトップは Tauri の keyring / Stronghold プラグイン。
  - **Kotlin トラック**: `expect` / `actual` で `androidMain` / `iosMain` / `desktopMain` に実装。

### パスワードリセット（[features/auth.md](features/auth.md)）

- 秘密の質問の答えはハッシュ保存。比較は正規化して行う。
- `POST /auth/password-reset/*` にはレート制限と試行回数ロックを設ける（閾値は → [todo.md](todo.md)）。
- 当面の秘密の質問方式は `request` 応答で登録済みユーザー固有の質問文を返すため、メールの実在判別を避けられない既知の制約とする。未登録メールを完全に秘匿するのは、将来のメールベースのリセット導入時とする。
- 緩和策として、未登録メールにもメールのハッシュから固定候補集合を選んだ一定のダミー質問文を決定的に返すデコイ方式を検討する（→ [todo.md](todo.md)）。`confirm` は未登録メール・質問不一致・答え不一致をすべて同じ 400 とし、理由を区別しない。
- 秘密情報（DB 認証情報・JWT 署名鍵・ストレージ認証情報・Webhook 等）は、グローバル CLAUDE.md「秘密情報の標準取り扱い要件」に従う（[architecture.md](architecture.md) 参照）。
  - 実値は `.gitignore` 対象の `.env.development` / `.env.test` / `.env.production` にのみ置く（root CLAUDE.md「環境変数は開発 / テスト / 本番で分離」）
  - コミット対象ファイルは環境変数展開 / プレースホルダで参照する
  - `.env.development.example` / `.env.test.example` / `.env.production.example` にプレースホルダのみ記載してコミットする
  - 推測可能な値（`root` / `password` / `admin` 等）を使わない

## テストデータ規約（グローバル CLAUDE.md「テストデータの標準要件」準拠）

- メールは `@example.com` / `@example.org` / `@example.net` のみ。
- ユーザー名は `testuser_%` / `e2euser_%` 等の接頭辞、本文は `[E2E_TEST]` 等のタグを付ける。
- パスワードは `TestPass123!` のようなテスト専用固定値。
- SNS URL などのダミーは実在しないドメイン（`example.com` / `test.invalid`）を使う。
- 識別子ベースで一括削除する `cleanup` スクリプトを用意し、テスト後に残数 0 を確認する。
- テストの DB 接続先はローカル（Docker）またはテスト専用環境に限定する。

## パフォーマンス

- レシピ一覧 / フィード API のレスポンスは通常時 300ms 以内（ローカル環境目安）。
- 一覧取得時、`isFollowing` / `isFavorited` は**まとめて取得**し N+1 クエリを避ける。各種カウント（`favoriteCount` / `commentCount` / フォロー数 / フォロワー数）は**カウント列キャッシュ**（下記）から読むだけで済む。
- 画像: サムネイル 1 枚・手順画像は手順 1 行につき 1 枚・感想画像は感想 1 件につき 1 枚・アバター 1 枚。いずれも 1 枚あたり最大 5MB（初期値、実装時に調整可。[features/image.md](features/image.md)）。
- 通知一覧の取得時、未読件数も同時に返して往復を減らす。`followee_new_recipe` の fan-out（フォロワー全員への配布）の実装方式は → [todo.md](todo.md)。

### ページング（横断・重要）

- **すべての一覧、および レシピ詳細の感想スレッドは、カーソルページングによる無限スクロール**とする。
- リクエストは `limit` + `cursor`、レスポンスは `items` + `nextCursor`（末尾なら `null`）。
- 並び順には必ず一意になるタイブレーカーを含め、時刻のみのソートは禁止する。標準は `(created_at DESC, id DESC)`。お気に入りレシピタブは `(favorites.created_at DESC, favorites.recipe_id DESC)` など、そのリストの基準時刻 + ID とする。
- `cursor` には最後の要素の `(ソートキーの値, id)` の両方をエンコードする（不透明トークンで可）。
- これにより、同時刻のレコードでもページ間の重複・抜けが起きないようにする。
- **オフセットページング（`page` / `offset`）は使わない**（新規投稿による重複・抜けを避けるため）。
- 対象: 全体 / フォロー / フォロワー / お気に入りレシピ フィード、検索結果、閲覧履歴、自分のレシピ一覧、ユーザーの公開レシピ一覧、フォロー中 / フォロワー一覧、通知一覧、感想一覧。

## カウント列キャッシュのトランザクション方針（横断・重要）

対象: `users.follower_count` / `users.following_count` / `recipes.favorite_count` / `recipes.comment_count`（[data-model.md](data-model.md) に列定義）。

- 関連テーブル（`follows` / `favorites` / `recipe_comments`）への **INSERT / DELETE と、カウント列の原子的増減（`SET c = c ± 1`）を、同一トランザクション**で実行する。
- 関連テーブルは複合 PK ＋ `INSERT ... ON CONFLICT DO NOTHING`、DELETE は削除件数チェックで冪等にし、**実際に行が増減したときだけ**カウントを更新する。
- 同一対象への同時操作（同じレシピへの同時お気に入り、同じユーザーへの同時フォロー等）は **DB の行ロックで直列化**される。**クライアントにエラーは返さず、クライアント側の再試行も不要。**
- デッドロック回避のため、フォロー / フォロー解除で複数の `users` 行を触る場合は、カウント更新前に対象行を **id 昇順で `SELECT ... FOR UPDATE`** してから更新する（[features/follow.md](features/follow.md)）。お気に入り / 感想はそれぞれ単一の `recipes` 行だけを更新するため、複数行のロック順序問題はない。
- それでも `deadlock` / `serialization_failure` が発生したら、**サーバー側で**（SQLAlchemy セッション単位で）トランザクションを数回リトライする（上限は → [todo.md](todo.md)）。
- アカウント削除は**単一のアプリケーショントランザクション**で行い、CASCADE で削除される `follows` / `favorites` / `recipe_comments` に対応して、生き残る他ユーザーの `following_count` / `follower_count` と他レシピの `favorite_count` / `comment_count` を、同一トランザクション内で減算またはピンポイントに数え直してからコミットする（[features/profile.md](features/profile.md)）。`recipe_views` も CASCADE で消えるが、カウント列キャッシュには関与しないため補正は不要。
- 多層防御として、カウントを実数から数え直して補正する**定期ジョブ**を用意する（頻度は → [todo.md](todo.md)）。アカウント削除時の整合は削除トランザクション内で取り、後追いの補正ジョブ任せにしない。

## データの可視性ルール（横断・重要）

- **非公開レシピは、投稿者本人以外に対して、次のいずれにも出さない**: ホームの「全体 / フォロー / フォロワー」タブ / 検索結果 / 他ユーザープロフィール / 他人のお気に入り一覧 / 感想の対象。
- **お気に入り**は「公開レシピ」＋「自分が投稿した非公開レシピ」に対して可能（他人の非公開は不可）。お気に入りレシピ一覧（＝ホームの「お気に入りレシピ」タブ）には自分の非公開レシピも表示される。
- 他人のレシピがお気に入り後に**非公開化**された場合、お気に入り一覧に表示しない（`favorites` 行は残る）。**削除**された場合は `favorites.recipe_id` の `ON DELETE CASCADE` で `favorites` 行ごと消える。
- **閲覧履歴**（[features/view-history.md](features/view-history.md)）も同じ考え方: `GET /users/me/history` は `is_public = true OR author = me` でフィルタする（非公開化された他人のレシピは一覧に出さない。`recipe_views` 行は残す）。レシピ削除では `recipe_views.recipe_id` の `ON DELETE CASCADE` で行ごと消える。他ユーザーの閲覧履歴を見る手段は無い。
- **他ユーザーのプロフィール取得では、公開トグル OFF の項目（メール / X / Instagram / その他 URL）を絶対にレスポンスに含めない**。本人取得時のみ全項目 + トグル状態を返す。
- 非公開レシピには感想を付けられない（実質、投稿者しか見られず投稿者は自分のレシピに感想を書けないため）。
- **材料のレシピ参照**: 公開レシピの材料が、投稿者の非公開レシピを参照している場合、他人はその材料名（`ref_recipe_title` / `name` のスナップショット）は見えるが、リンク先を開くと 404（非公開レシピの詳細は他人に出さない）。参照できるのは自分のレシピのみなので、他人のレシピが自分の非公開レシピを参照することはない。

## ログ / エラーハンドリング

- サーバーは構造化ログ（JSON、リクエスト ID 付き）を出力する。実現手段は標準 `logging` の JSON フォーマッタまたは `structlog`（実装時に確定 → [todo.md](todo.md)）。
- 想定内エラーは [api.md](api.md) の統一エラー形式で返す。5xx はスタックトレースをクライアントに返さない。
- バリデーションはリクエスト受信時に一括で行い、複数エラーを返せる形にする。

## AI エンドポイント（`/api/v1/ai/*`・Phase 11。[features/ai-proofread.md](features/ai-proofread.md)）

- **認証必須。**
- **レート制限**をユーザーごとに設ける（コスト・濫用対策。閾値の例: 20 回/時・100 回/日 → [todo.md](todo.md)）。超過は 429。
- **タイムアウト**を設ける（サーバー 15 秒 / クライアント 20 秒目安）。超過・プロバイダ障害は 503（`AI_UNAVAILABLE`）。編集画面をブロックしない。
- **入力の上限**（超過は 400）: `items` の件数（例: 200）、各 `text`（例: 2,000 字）、`text` の合計（例: 8,000 字）、`id`（例: 64 字）。総文字数だけでなく件数も縛る。
- **任意機能**: レシピの保存フローは AI 呼び出しの成否に依存しない（AI を使わなくても保存できる）。
- **プロバイダ差**: `AI_PROVIDER` = `local`（dev）/ `anthropic`（prod）/ `stub`（test）。ローカルの小型モデルはクラウドより精度が落ちるため、同じ入力でも dev / prod で校正結果が変わりうる（「提案」機能なので許容）。
- **秘密情報**: AI プロバイダの API キー（`ANTHROPIC_API_KEY` 等）はグローバル CLAUDE.md「秘密情報の標準取り扱い要件」に従い `.env` のみに置く。`.env.*.example` はプレースホルダ。
- レシピ本文をアクセスログ等に不要に残さない（本人コンテンツで機微度は低いが最小限にする）。

## 破壊的操作

- アカウント削除は不可逆。クライアントに確認ダイアログを必須化する。削除は成功時 204。削除前に `users.token_version` を原子的に `+1` し、削除後は認証依存性のユーザー存在チェックでも拒否するため、削除前に発行されたアクセストークンでの以降のリクエストは 401 になる。リフレッシュトークンは CASCADE 削除する。専用の冪等機構は設けない。詳細は [features/profile.md](features/profile.md)。

## 対応プラットフォーム

フロントエンドは 2 トラック（[tech-stack.md](tech-stack.md)）。どちらも Android / iOS / Desktop（Windows・macOS）を対象とする。

- **TypeScript トラック（必須）**: iOS / Android = Expo（React Native）。Desktop = React Native Web ビルドを Tauri 2 でパッケージ。
- **Kotlin トラック（随時）**: Android / iOS / Desktop = Compose Multiplatform（Desktop は JVM）。

- **Android**: minSdk は実装時に確定（目安 API 26 / Android 8.0 以上）。
- **iOS**: 対応下限は実装時に確定（目安 iOS 15 以上）。
- **Desktop**: Windows / macOS。最小 OS バージョン・ウィンドウ最小サイズは実装時に確定。
- ブラウザ（Web）単体配信は対象外（将来検討）。TS トラックの RN Web ビルドは Tauri デスクトップの土台としてのみ使う。
- → [todo.md](todo.md)
