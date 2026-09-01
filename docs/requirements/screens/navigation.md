# ナビゲーション構造

## 方針

- **モバイル（コンパクト幅）**: 画面下部に**ボトムナビゲーション**（5 destination）。
- **デスクトップ / タブレット（中〜広幅）**: 画面左に**ナビゲーションレール**（同じ 5 destination）。
- 各クライアントで、ウィンドウ幅のブレークポイントに応じて adaptive に切り替える（compact = ボトムバー、medium / expanded = レール）。ブレークポイントの具体値は実装時に確定（→ [`../todo.md`](../todo.md)）。
- 現行案の「上部バーに検索バー常駐 + アカウントメニュー」は廃止。アカウント関連は「マイページ」destination に集約する。
- **検索は独立 destination を持たず、[ホーム](home.md)画面の最上部に常時固定した検索窓**で行う（表示中のサブタブ内を絞り込む。[home.md](home.md) / [`../features/search.md`](../features/search.md)）。

## 5 つの destination

| destination | 画面 | 説明 |
| --- | --- | --- |
| ホーム | [home.md](home.md) | 最上部に常時固定の検索窓 ＋ 4 サブタブ（全体 / フォロー / フォロワー / お気に入りレシピ）のフィード |
| 履歴 | [history.md](history.md) | 最近見たレシピの一覧（[`../features/view-history.md`](../features/view-history.md)） |
| ＋（作成） | [recipe-editor.md](recipe-editor.md) | タップでレシピ作成画面をフルスクリーンダイアログ（モーダル）で開く。タブ自体は選択状態にしない |
| 通知 | [notifications.md](notifications.md) | 通知一覧。未読があればアイコンにバッジ |
| マイページ | [my-page.md](my-page.md) | 自分のプロフィール概要 ＋ メニュー |

- 5 項目なので「＋」は中央（3 番目）に置き、目立つスタイルにできる。並びは ホーム / 履歴 / ＋ / 通知 / マイページ。
- 「＋」はモーダル起動なので、閉じると直前の destination に戻る。
- 「通知」バッジの数は `GET /notifications/unread-count`（または一覧レスポンスの `unreadCount`）。既読化で減る。

## 画面の実装レイヤー

> 各トラックの状態管理 / DI / ナビゲーションの具体ライブラリは未確定（→ [`../todo.md`](../todo.md)）。ここでは役割レベルの構造を示す。名称は「相当」（例: ViewModel 相当 = 画面の状態を保持し再描画に耐える層）。

### ナビゲーション階層

```mermaid
flowchart TD
    Entry["プラットフォーム別エントリ<br/>（各クライアントの Android / iOS / Desktop エントリ）"]
    Entry --> Root["App ルート（各クライアントのルート画面 / ルーター）"]
    Root --> Splash["スプラッシュ（認証判定）"]
    Splash -->|未ログイン| AuthFlow["認証フロー<br/>ログイン / サインアップ / パスワードリセット"]
    Splash -->|ログイン済み| Shell

    subgraph Shell["メインシェル（adaptive: ボトムバー ⇔ ナビゲーションレール）"]
      direction LR
      D1["ホーム"]
      D2["履歴"]
      D3["＋ 作成（モーダル）"]
      D4["通知"]
      D5["マイページ"]
    end

    D1 --> S_Home["ホーム画面<br/>（常時固定の検索窓 ＋ 4サブタブ）"]
    D2 --> S_History["閲覧履歴画面"]
    D4 --> S_Notif["通知一覧画面"]
    D5 --> S_MyPage["マイページ画面"]

    S_Home -. push .-> S_Detail["レシピ詳細"]
    S_History -. push .-> S_Detail
    S_Notif -. push .-> S_Detail
    S_Notif -. push .-> S_UserProfile["ユーザープロフィール（他人）"]
    S_MyPage -. push .-> S_MyRecipes["自分のレシピ一覧"]
    S_MyPage -. push .-> S_Connections["フォロー・フォロワー"]
    S_MyPage -. push .-> S_ProfileEdit["プロフィール編集"]
    S_Detail -. push .-> S_UserProfile
    S_Detail -. モーダル .-> S_Editor["レシピ作成 / 編集"]
    D3 -. モーダル .-> S_Editor
```

- 認証フローとメインシェルは別スタック。ログイン成功でメインシェルに差し替え（認証フローは履歴に残さない）。
- 各 destination は独立したスタックを持ち、`push` は現在の destination のスタックに積む（[バックスタック](#バックスタック)）。
- 破線 `モーダル` はスタックに積まないフルスクリーンダイアログ。

### 1 画面の内部レイヤー（共通）

> どちらのフロントトラック（TypeScript / Expo、Kotlin / Compose）も同じ層構造を持つ。層の呼び名はトラックで異なる（例: 状態保持層 = Kotlin では ViewModel 相当、TS では hooks / ストア相当）。

```mermaid
flowchart TD
    Screen["画面コンポーネント<br/>（レイアウト・入力・状態の描画）"]
    Screen --> Common["共通コンポーネント<br/>レシピカード / ユーザー行 / 感想アイテム / 確認ダイアログ 等<br/>（components.md）"]
    Screen --> State["状態保持層（ViewModel / hooks 相当）<br/>画面の状態・イベント処理・楽観更新"]
    State --> Data["データ取得層（Repository / query 相当）<br/>API 呼び出し・ページング・キャッシュ方針"]
    Data --> Http["HTTP クライアント層<br/>（Kotlin: Ktor Client ／ TS: openapi-fetch）<br/>認証ヘッダ・トークン更新（single-flight）"]
    Http --> Api[("FastAPI<br/>（../api.md）")]

    State -. 型・整形を利用 .-> Gen["OpenAPI 生成の API クライアント / 型<br/>＋ 表示整形（単位の前置表記 等）<br/>（Kotlin: shared モジュール ／ TS: expoApp 内）"]
    Data -. 使用 .-> Gen
    Http -. 使用 .-> Gen
```

- **状態保持層**: 画面ごとに 1 つ。API レスポンス（生成した型）を画面表示用の状態に変換して保持。♡ やフォローの楽観更新もここ。
- **データ取得層**: エンドポイント単位のまとまり。カーソルページング（[`../non-functional.md`](../non-functional.md)）の cursor 管理もここ（TS は TanStack Query の `useInfiniteQuery`）。
- **HTTP クライアント層**: アクセストークン付与、401 時のリフレッシュ（single-flight）、`token_version` 不一致でのログアウト誘導（[`../features/auth.md`](../features/auth.md)）。
- **OpenAPI 生成物 ＋ 表示整形**: OpenAPI（FastAPI が出力）から生成した API クライアント / 型と、クライアント内部の表示整形ロジック。Kotlin は `shared` モジュール、TS は `expoApp` 内に持つ（[`../architecture.md`](../architecture.md)、[`../tech-stack.md`](../tech-stack.md)）。

## バックスタック

- **destination ごとに独立したナビゲーションスタック**を保持する。タブを切り替えても各タブの位置は保たれる。
- 既に選択中の destination をもう一度タップ → そのタブのスタックをルートまで戻す（先頭がリストなら最上部へスクロール）。
- Android の戻るキー / デスクトップの戻る操作: 現在のタブのスタックを 1 つ戻す。ルートで戻る → ホーム destination へ。ホームのルートで戻る → アプリ終了確認（プラットフォーム標準）。
- **モーダル**（レシピ作成 / 編集、確認ダイアログ、画像ピッカー）はスタックに積まず、閉じると元の画面に戻る。

## 認証ゲート

- **当面、アプリの全画面（スプラッシュ / ログイン / サインアップ / パスワードリセットを除く）はログイン必須**とする。5 destination とそこから開く画面（レシピ詳細を含む）すべてが対象。
  - `GET /recipes/{id}` は API 仕様上は公開レシピを匿名でも返せる（[`../features/recipe.md`](../features/recipe.md)）が、当面のクライアントはこの匿名アクセスを使わない（将来の共有リンク / Web 版のために API 側の余地として残す）。
- 未ログインで保護画面に到達しようとしたら、ログイン画面へ差し替える。
- ログイン / サインアップ成功後、**元々行こうとしていた画面**があればそこへ、なければホームへ。
- スプラッシュ（[splash.md](splash.md)）で「ログインを保持」による自動再ログインを試み、成否で分岐。
- アクセストークンが `token_version` 不一致 / ユーザー不在で 401（アカウント削除・パスワードリセット後）→ ローカルのトークンを破棄しログイン画面へ（[`../features/auth.md`](../features/auth.md)）。

## ディープリンク（アプリ内）

- **通知タップ** → 対象へ:
  - `followed` → その行為者の[ユーザープロフィール](user-profile.md)
  - `recipe_favorited` / `recipe_commented` / `followee_new_recipe` → [レシピ詳細](recipe-detail.md)
- 遷移時にその通知を既読化する。
- 削除済み対象の通知はサーバーが一覧から除外する（[`../features/notification.md`](../features/notification.md)）。取得後・タップ前に削除された稀なケースは遷移先で 404 → 「表示できません」→ 一覧へ戻す。
- 外部ディープリンク（URL スキーム / ユニバーサルリンク）は対象外（→ [`../todo.md`](../todo.md)）。

## トップアプリバー（各画面固有）

グローバルなアプリバーは廃止。各画面が必要に応じて薄いアプリバーを持つ:

- タイトル（画面名 or 文脈。ホームはロゴ。**ホームはロゴのすぐ下に常時固定の検索窓**を持つ）
- 戻る矢印（スタックの 2 階層目以降）
- 文脈アクション（例: レシピ詳細の「編集 / 削除」、レシピ作成の「保存」）

詳細は各画面ファイルの「レイアウト」。

## プラットフォーム差分

| | モバイル | デスクトップ |
| --- | --- | --- |
| 主ナビ | 画面下部のボトムナビ（5 項目） | 画面左のナビゲーションレール（5 項目） |
| ＋（作成） | ボトムナビ中央（3 番目・目立つスタイル） | レール内。フルスクリーンではなく大きめのダイアログでも可（実装時に確定） |
| 戻る | OS の戻るキー / スワイプ + アプリバーの戻る矢印 | アプリバーの戻る矢印 + キーボード（Esc でモーダルを閉じる） |
| 一覧幅 | 画面幅いっぱい | 最大幅を設けて中央寄せ。2 ペイン（一覧 + 詳細）は将来検討（→ [`../todo.md`](../todo.md)） |

## UX 方針（全画面共通）

- **モバイル**: 片手操作を前提に、主要アクション（保存・送信・追加）は画面下部に寄せる。画像は端末のカメラ / ギャラリーから。
- **デスクトップ**: キーボード操作（Tab 移動、Enter 送信、Esc でモーダルを閉じる）とマウスに配慮。画像は OS のファイル選択ダイアログ。ウィンドウはリサイズ可能。
- **一覧・感想スレッドはすべてカーソルページングによる無限スクロール**（[`../non-functional.md`](../non-functional.md)）。
- 破壊的操作の前に[確認ダイアログ](components.md)。
- 下書き保持・オフライン対応・ブラウザ（Web）版は対象外（→ [`../todo.md`](../todo.md)）。
