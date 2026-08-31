# ユーザープロフィール（他人）

## 1. 目的

他ユーザーのプロフィールと、その人の公開レシピを見る。フォロー / フォロー解除もここから。機能仕様は [`../features/profile.md`](../features/profile.md) / [`../features/follow.md`](../features/follow.md)。

> 自分自身のプロフィールは[マイページ](my-page.md)。

## 2. ナビゲーション

- 入口: [レシピ詳細](recipe-detail.md)の投稿者名 / [フォロー・フォロワー](connections.md)の行 / [通知一覧](notifications.md)の `followed` 通知。
- 出口: [レシピ詳細](recipe-detail.md)（カードタップ）/ [フォロー・フォロワー](connections.md)（フォロー数 / フォロワー数タップ）。
- 戻る: 呼び出し元へ。
- 認証: 必要。
- パラメータ: ユーザー ID。

## 3. レイアウト（上 → 下）

- アプリバー: 表示名 + 戻る矢印
- アバター + 表示名
- フォロー数 / フォロワー数（タップで[フォロー・フォロワー](connections.md)、対象 = このユーザー）
- フォローボタン（「フォロー」/「フォロー中」）
- 連絡先・SNS: **公開トグル ON の項目のみ**（メール / X / Instagram / その他 URL）
- その人の公開レシピ一覧（[レシピカード](components.md)、無限スクロール）

## 4. 状態

| 状態 | 表示 |
| --- | --- |
| loading | スケルトン |
| 404（ユーザー不在 / 削除済み） | 「このユーザーは見つかりません」＋戻る |
| レシピ empty | 「まだ公開レシピがありません」 |
| 非公開項目 | 公開トグル OFF の連絡先・SNS はそもそもレスポンスに含まれない（[`../non-functional.md`](../non-functional.md)） |

## 5. アクションと結果

- プロフィール取得 → `GET /users/{id}`（他人取得: 公開項目のみ + フォロー数 / フォロワー数 + `isFollowing`）。
- レシピ一覧 → `GET /users/{id}/recipes`（他人なので公開のみ）。
- フォローボタン → `POST` / `DELETE /users/{id}/follow`。楽観更新（数とボタン表記を即時反映）。
- SNS リンクタップ → 外部ブラウザで開く（デスクトップは既定ブラウザ）。

## 6. 使用 API

- `GET /users/{id}`
- `GET /users/{id}/recipes`
- `POST` / `DELETE /users/{id}/follow`
- （[`../api.md`](../api.md)）

## 7. プラットフォーム差分

- デスクトップ: 最大幅で中央寄せ。SNS リンクは既定ブラウザで開く。
