# 閲覧履歴

## 1. 目的

最近見たレシピを最近見た順に一覧する。機能仕様は [`../features/view-history.md`](../features/view-history.md)。

## 2. ナビゲーション

- 入口: ボトムナビ / レールの「履歴」destination（[navigation.md](navigation.md)）。
- 出口: [レシピ詳細](recipe-detail.md)（カードタップ）。ボトムナビで他 destination へ。
- 戻る: 履歴のスタックを 1 つ戻す。ルートで戻る → ホーム destination へ。「履歴」再タップ → 最上部へスクロール。
- 認証: 必要（本人の履歴のみ）。

## 3. レイアウト（上 → 下）

- アプリバー: 「閲覧履歴」+ 右に「消去」（destination のルートなので戻る矢印は無い）
- 本文: [レシピカード](components.md)の縦リスト（最近見た順、無限スクロール）

## 4. 状態

| 状態 | 表示 |
| --- | --- |
| loading | スケルトン |
| empty | 「まだ見たレシピがありません」 |
| error | 「読み込みに失敗しました」＋「再試行」 |

## 5. アクションと結果

- 一覧取得 → `GET /users/me/history`。可視性フィルタ済み（非公開化された他人のレシピは含まれない。[`../features/view-history.md`](../features/view-history.md)）。
- カードタップ → [レシピ詳細](recipe-detail.md)。
- 「消去」→ [確認ダイアログ](components.md)「閲覧履歴をすべて消去しますか？」→ `DELETE /users/me/history` → 空状態、スナックバー「閲覧履歴を消去しました」。
- **対象消失（稀）**: 一覧取得後・タップ前に対象が非公開化 / 削除された場合、遷移先が 404。「表示できません」を表示し履歴へ戻す（[通知一覧](notifications.md)と同じ）。
- 引っぱって更新 → 再取得。

## 6. 使用 API

- `GET /users/me/history`
- `DELETE /users/me/history`
- （記録は[レシピ詳細](recipe-detail.md)側の `POST /recipes/{id}/view`。[`../api.md`](../api.md)）

## 7. プラットフォーム差分

- モバイル: 引っぱって更新。
- デスクトップ: 最大幅で中央寄せ。「更新」ボタン。
