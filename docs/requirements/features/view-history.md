# 閲覧履歴（最近見たレシピ）

## 1. 目的・概要

ユーザーが最近見たレシピを一覧で振り返れるようにする。ボトムナビゲーション / ナビゲーションレールの**「履歴」destination**から「閲覧履歴」画面に入り、最近見た順にレシピカードが並ぶ。カードをタップするとレシピ詳細へ。

履歴は**サーバー保存**（`recipe_views`）なので、同じアカウントなら端末をまたいで同じ履歴が見える。

## 2. 画面・UI

- 画面設計は [../screens/history.md](../screens/history.md)。
- 入口: ボトムナビゲーション / ナビゲーションレールの「履歴」destination（[../screens/navigation.md](../screens/navigation.md)）。
- 本文: [レシピカード](../screens/components.md)の縦リスト（最近見た順、**カーソルページングによる無限スクロール**。[../non-functional.md](../non-functional.md)）。
- アプリバー右に「消去」。
- 空状態: 「まだ見たレシピがありません」。

## 3. 振る舞い・ルール

- **記録のトリガー**: [レシピ詳細](../screens/recipe-detail.md)を開いて `GET /recipes/{id}` の取得に成功したあと、クライアントが `POST /recipes/{id}/view` を**非同期で**呼ぶ（`GET /recipes/{id}` 自体に副作用を持たせない。[../processing-model.md](../processing-model.md) §6・§10）。失敗しても画面には影響しない（履歴に載らないだけ）。一覧カードのタップ自体では記録しない（詳細を実際に開いたときだけ）。
- **重複の集約**: 同じレシピを何度見ても `recipe_views` は 1 行。`viewed_at` が最後に見た時刻に更新される（upsert）。一覧では常に「最後に見た時刻」の降順。
- **可視性フィルタ**: `GET /users/me/history` は `is_public = true OR author = me` のレシピだけを返す（他人のレシピが後から非公開化された場合は履歴一覧から外れる。[../non-functional.md](../non-functional.md) の可視性ルール。お気に入りタブと同じ考え方）。`recipe_views` の行自体は残す。
- **削除**: レシピが削除されると `recipe_views` 行は `ON DELETE CASCADE` で消える。アカウント削除でも `user_id` 側の CASCADE で消える（[../data-model.md](../data-model.md)）。
- **取得後・タップ前の消失（稀）**: 一覧取得後にレシピが非公開化 / 削除されると、タップ時に詳細が 404。「表示できません」を表示して閲覧履歴へ戻す（[通知一覧](../screens/notifications.md)と同じパターン）。
- **保持上限**: ユーザーあたりの保持件数の上限と、超過分の削除方式（挿入時にトリミング / 定期ジョブ）は → [../todo.md](../todo.md)。
- **プライバシー**: 履歴は本人だけが見られる（`GET /users/me/history` は本人のみ）。他ユーザーの閲覧履歴を見る手段は無い。

## 4. データモデル

`recipe_views` テーブル（[../data-model.md](../data-model.md)）:

- PK `(user_id, recipe_id)` — レシピごとに 1 行。
- `user_id` FK → `users.id`（ON DELETE CASCADE）、`recipe_id` FK → `recipes.id`（ON DELETE CASCADE）。
- `viewed_at` timestamptz NOT NULL。
- index `(user_id, viewed_at DESC)`（一覧クエリ用）。
- 再閲覧は `INSERT ... ON CONFLICT (user_id, recipe_id) DO UPDATE SET viewed_at = now()`。
- カウント列キャッシュには関与しない。

## 5. API

### POST `/recipes/{id}/view`（認証必要）

- 閲覧を記録する。body なし。
- レシピが見えない場合（他人の非公開 / 不在）→ 404（[../api.md](../api.md) の非公開リソース 404 統一）。
- 成功 → 204。繰り返し呼んでも安全（重複行は作らず、エラーも返さない）。ただし毎回 `viewed_at` を更新するので厳密には冪等ではない（同じレシピの履歴が先頭へ移動する）。クライアントは詳細を開くたびに 1 回だけ呼べばよく、失敗時のリトライは不要。

### GET `/users/me/history`（認証必要）

- 最近見たレシピ一覧。並びは `viewed_at DESC, recipe_id DESC`（タイブレーカー付き）。**カーソルページング**（`limit`, `cursor` → `items`, `nextCursor`）。
- 可視性フィルタ: `is_public = true OR recipes.user_id = me`。
- 各要素はフィード（[home-feed.md](home-feed.md)）と同じレシピカード形状（`id` / `title` / `thumbnailUrl` / `author` / `favoriteCount`）。加えて `viewedAt` を含める。

```json
// response 200
{
  "items": [
    { "id": "…", "title": "肉じゃが", "thumbnailUrl": "https://…",
      "author": { "id": "…", "displayName": "テスト太郎", "avatarUrl": "https://…" },
      "favoriteCount": 12, "viewedAt": "2026-09-01T12:00:00Z" }
  ],
  "nextCursor": "…"
}
```

### DELETE `/users/me/history`（認証必要）

- 自分の `recipe_views` を全削除。成功 → 204。

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| `POST /recipes/{id}/view` の `{id}` | 存在し、閲覧者に見えるレシピ。見えなければ 404 |
| `GET /users/me/history` の `limit` | 1〜50（既定 20） |

## 7. 受け入れ基準

- [ ] レシピ詳細を開くと、そのレシピが閲覧履歴の先頭に出る
- [ ] 同じレシピを見直すと、履歴の中で先頭に移動する（重複行は増えない）
- [ ] 他人のレシピを見たあとそのレシピが非公開化されると、閲覧履歴一覧から消える
- [ ] レシピが削除されると閲覧履歴一覧から消える
- [ ] 「消去」で履歴が空になる
- [ ] 別端末で同じアカウントにログインすると同じ履歴が見える
- [ ] 履歴一覧はカーソルページングで全件たどれる
- [ ] `POST /recipes/{id}/view` が失敗してもレシピ詳細の表示に影響しない

## 8. 未確定・メモ

- 保持件数の上限と超過分の削除方式 → [../todo.md](../todo.md)
- 履歴からの個別削除（1 件ずつスワイプ削除など）を入れるか → [../todo.md](../todo.md)
- 「履歴に基づくおすすめ」など将来の活用 → 将来
