# 通知一覧

## 1. 目的

自分あての通知（フォローされた / お気に入りされた / 感想がついた / フォロー中の新着レシピ）を確認する。機能仕様は [`../features/notification.md`](../features/notification.md)。

> **MVP でのスコープ**: 通知は Phase 8 の機能。Phase 4（MVP）では「通知」destination を**空状態（「通知はまだありません」）固定の最小スタブ**として置くだけで、`notifications` テーブル・API・バッジは作らない（[../roadmap.md](../roadmap.md)「MVP ライン」）。

## 2. ナビゲーション

- 入口: ボトムナビ / レールの「通知」（未読があればアイコンにバッジ）。
- 出口: [レシピ詳細](recipe-detail.md) / [ユーザープロフィール](user-profile.md)（行タップ）。
- 戻る: 通知スタックを 1 つ戻す。「通知」再タップ → 最上部へスクロール。
- 認証: 必要。

## 3. レイアウト

- アプリバー: 「通知」+ 右に「すべて既読」
- 本文: [通知アイテム](components.md)の縦リスト（新しい順、無限スクロール）。未読は強調。

## 4. 状態

| 状態 | 表示 |
| --- | --- |
| loading | スケルトン |
| empty | 「通知はまだありません」 |
| error | 「読み込みに失敗しました」＋「再試行」 |

> 対象（レシピ / 感想 / 行為者）が削除された通知はサーバーが一覧から除外する（[../features/notification.md](../features/notification.md)）。一覧取得後・タップ前に削除された稀なケースは §5 の「対象消失」参照。

## 5. アクションと結果

- 一覧取得 → `GET /notifications`（レスポンスに `items` / `unreadCount` / `nextCursor`）。バッジ数を `unreadCount` に更新。
- 行タップ → 対象へ遷移（[navigation.md](navigation.md) ディープリンク）＋ `POST /notifications/read`（その ID）→ その行を既読化、バッジ -1。
- 「すべて既読」→ `POST /notifications/read`（body 省略）→ 全行既読化、バッジ 0。
- **対象消失（稀）**: 一覧取得後・タップ前に対象が削除された場合、遷移先が 404 になる。「表示できません」を表示し通知一覧へ戻す。

## 6. 使用 API

- `GET /notifications`
- `GET /notifications/unread-count`（一覧を開かずバッジだけ更新したいとき。他 destination 滞在中のポーリング要否は実装時に確定 → [`../todo.md`](../todo.md)）
- `POST /notifications/read`
- （[`../features/notification.md`](../features/notification.md)）

## 7. プラットフォーム差分

- モバイル: 引っぱって更新。
- デスクトップ: 「更新」ボタン or 一定間隔で `unread-count` をポーリングしてバッジ更新（実装時に確定）。
