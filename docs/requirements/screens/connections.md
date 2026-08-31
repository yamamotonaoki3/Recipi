# フォロー・フォロワー

## 1. 目的

「フォロー中」「フォロワー」のユーザー一覧を 2 タブで見る。自分のものと、他ユーザーのものを同じ画面で扱う。機能仕様は [`../features/follow.md`](../features/follow.md)。

## 2. ナビゲーション

- 入口:
  - 自分: [マイページ](my-page.md)のメニュー「フォロー・フォロワー」、またはマイページのフォロー数 / フォロワー数タップ。
  - 他人: [ユーザープロフィール](user-profile.md)のフォロー数 / フォロワー数タップ。
- 出口: [ユーザープロフィール](user-profile.md)（行タップ。自分の行なら[マイページ](my-page.md)）。
- 戻る: 呼び出し元へ。
- 認証: 必要。
- パラメータ: 対象ユーザー ID（自分 or 他人）＋ 初期選択タブ（フォロー中 / フォロワー）。

## 3. レイアウト

- アプリバー: 対象の表示名（自分なら「フォロー・フォロワー」）+ 戻る矢印
- 上部タブ: 「フォロー中」「フォロワー」
- 各タブ: [ユーザー行](components.md)のリスト（無限スクロール）

## 4. 状態

| 状態 | 表示 |
| --- | --- |
| loading | スケルトン |
| empty（フォロー中） | 「まだ誰もフォローしていません」（他人の場合「まだ誰もフォローしていません」） |
| empty（フォロワー） | 「まだフォロワーがいません」 |
| error | 「読み込みに失敗しました」＋「再試行」 |

## 5. アクションと結果

- タブ取得:
  - 自分: `GET /users/me/following` / `GET /users/me/followers`
  - 他人: `GET /users/{id}/following` / `GET /users/{id}/followers`
- 行のフォローボタン → `POST` / `DELETE /users/{userId}/follow`。楽観更新。自分自身の行にはボタンを出さない。
- 行タップ → その行が他人なら[ユーザープロフィール](user-profile.md)、自分なら[マイページ](my-page.md)。

## 6. 使用 API

- `GET /users/me/following` / `GET /users/me/followers`
- `GET /users/{id}/following` / `GET /users/{id}/followers`
- `POST` / `DELETE /users/{id}/follow`
- （[`../features/follow.md`](../features/follow.md)）

## 7. プラットフォーム差分

- モバイル: タブはスワイプでも切替。
- デスクトップ: 最大幅で中央寄せ。
