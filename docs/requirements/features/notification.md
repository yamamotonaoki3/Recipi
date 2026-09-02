# 通知（アプリ内通知）

## 1. 目的・概要

自分に関係する出来事（フォローされた・レシピがお気に入りされた・感想がついた・フォロー中ユーザーの新着レシピ）をアプリ内で知らせる。ボトムナビゲーション / ナビゲーションレールの「通知」アイコンに未読件数バッジを出し、「通知」destination の一覧で確認する。プッシュ通知は対象外。

## 2. 画面・UI

### 「通知」destination のアイコンバッジ

- ボトムナビ / レール（[../screens/navigation.md](../screens/navigation.md)）の「通知」アイコンに、未読があれば件数バッジ（`99+` 上限）。
- タップで通知一覧へ。

### 通知一覧画面（[../screens/notifications.md](../screens/notifications.md)）

- 通知を新しい順に表示（**カーソルページングによる無限スクロール**。[../non-functional.md](../non-functional.md)）。
- 未読は視覚的に強調（背景色など）。
- 各行: 行為者のアバター + 本文（例「〇〇さんがあなたをフォローしました」「〇〇さんが『肉じゃが』をお気に入りに追加しました」「〇〇さんが『肉じゃが』に感想を書きました」「〇〇さんが新しいレシピ『肉じゃが』を投稿しました」）+ 日時。
- 行タップで対象へ遷移（フォロー → 相手のプロフィール / お気に入り・感想・新着 → レシピ詳細）。遷移時にその通知を既読化。
- 「すべて既読にする」操作。
- 空状態: 「通知はまだありません」。

## 3. 振る舞い・ルール

### 通知種別

| `type` | 発生イベント | 受信者 | 遷移先 |
| --- | --- | --- | --- |
| `followed` | ユーザー A が B をフォロー | B | A のプロフィール |
| `recipe_favorited` | ユーザー A がレシピ R をお気に入り | R の投稿者 | R の詳細 |
| `recipe_commented` | ユーザー A がレシピ R に感想を投稿 | R の投稿者 | R の詳細（該当感想） |
| `followee_new_recipe` | ユーザー A が公開レシピ R を投稿 | A のフォロワー全員 | R の詳細 |

### 生成ルール

- **自分の操作による自分あて通知は作らない**（例: 自分のレシピを自分でお気に入り（[favorite.md](favorite.md)）しても通知しない）。
- `followed`: フォロー成立時のみ（冪等な再フォローでは作らない）。
- `recipe_favorited`: お気に入り成立時のみ。お気に入り解除しても、既存の `recipe_favorited` 通知は削除しない（通知は発生した出来事の履歴であり、後から取り消さない）。
- `recipe_commented`: 感想の新規投稿時のみ。編集では作らない。
- `followee_new_recipe`: 公開レシピの新規投稿時のみ作成する。非公開で作成後に公開化した場合は作成しない。
- 対象（レシピ / 感想 / 行為者）が削除された通知は一覧に表示しない（または削除。[../data-model.md](../data-model.md) の CASCADE）。
- アカウント削除時、その人あての通知（`user_id`）とその人が行為者の通知（`actor_id`）は CASCADE で消える。

## 4. データモデル

`notifications` テーブル:

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users.id`（ON DELETE CASCADE）。受信者 |
| `type` | string | `followed` / `recipe_favorited` / `recipe_commented` / `followee_new_recipe` |
| `actor_id` | uuid | FK → `users.id`（ON DELETE CASCADE）。行為者 |
| `recipe_id` | uuid | FK → `recipes.id`（ON DELETE CASCADE）、NULL 可 |
| `comment_id` | uuid | FK → `recipe_comments.id`（ON DELETE CASCADE）、NULL 可 |
| `read_at` | timestamptz | NULL 可（NULL = 未読） |
| `created_at` | timestamptz | |

- index(`user_id`, `created_at` DESC)
- 未読件数用に部分インデックス: index(`user_id`) WHERE `read_at IS NULL`
- `followee_new_recipe` の重複作成防止に、`(user_id, type, recipe_id)` の一意制約（`type = 'followee_new_recipe'` の部分一意インデックス等。形は Phase 8 で確定）

`notification_outbox` テーブル（fan-out 配布指示・Phase 8。[../processing-model.md](../processing-model.md) §9）:

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | uuid | PK |
| `event` | string | `followee_new_recipe` |
| `recipe_id` | uuid | FK → `recipes.id`（ON DELETE CASCADE） |
| `author_id` | uuid | FK → `users.id`（ON DELETE CASCADE） |
| `created_at` | timestamptz | |
| `processed_at` | timestamptz | NULL 可（NULL = 未処理） |

- index(`processed_at`)（未処理スイープ用）

## 5. API

### GET `/notifications`（認証必要）

```json
{
  "items": [
    {
      "id": "…", "type": "recipe_favorited", "readAt": null,
      "actor": { "id": "…", "displayName": "E2EUser A", "avatarUrl": "https://…" },
      "recipe": { "id": "…", "title": "肉じゃが" },
      "comment": null,
      "createdAt": "2026-08-31T10:00:00Z"
    }
  ],
  "unreadCount": 3,
  "nextCursor": null
}
```

- レスポンスに `unreadCount`（自分の未読通知総数）を含める。通知画面を開く際の往復を減らすため（[../non-functional.md](../non-functional.md)）。`GET /notifications/unread-count` はバッジ更新など一覧を取らない場面用。

### GET `/notifications/unread-count`（認証必要）

```json
{ "unreadCount": 3 }
```

### POST `/notifications/read`（認証必要）

- body: `{ "ids": ["…", "…"] }`（省略時は自分の全通知を既読化）
- 204

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| `ids` | 任意。自分あての通知 ID のみ有効（他人の通知 ID は無視 or 403） |

## 7. 受け入れ基準

- [ ] フォローされると被フォロー者に `followed` が 1 件作られる
- [ ] 自分のレシピが他人にお気に入りされると `recipe_favorited` が作られる
- [ ] お気に入りを解除しても、それ以前に作られた `recipe_favorited` 通知は残る
- [ ] 自分のレシピに他人が感想を書くと `recipe_commented` が作られる
- [ ] フォロー中ユーザーが公開レシピを投稿すると、（通常運用時）その時点のフォロワー全員に `followee_new_recipe` が作られる。障害回収が遅れた場合は配布処理の実行時点のフォロワーが対象になる（[../processing-model.md](../processing-model.md) §7・§9）
- [ ] 自分の操作で自分あての通知は作られない
- [ ] 未読バッジの数が `unread-count` と一致する
- [ ] 通知をタップ / 「すべて既読」で `read_at` が入り、バッジが減る
- [ ] 対象レシピ / 感想が削除された通知は一覧に出ない

## 8. 未確定・メモ

- fan-out（`followee_new_recipe`）は**公開レシピ作成トランザクション内で `notification_outbox` に 1 行だけ書き、コミット後に `BackgroundTasks` が配布、落ちた分は定期スイープが回収**する（[../processing-model.md](../processing-model.md) §3・§7・§9）。フォロワー集合は配布時点の `follows` で解決する。単一行の通知（`followed` / `recipe_favorited` / `recipe_commented`）は発火元と同一トランザクションで作る（実装は Phase 8）。大量フォロワー時の性能測定・専用ジョブキューの要否は → [../todo.md](../todo.md) #18
- 通知の保持期間・自動削除（古い通知・処理済み `notification_outbox` の掃除）→ [../todo.md](../todo.md)
- fan-out の受信者は配布処理の実行時点の `follows` で決まる（障害回収が遅れると投稿時点のフォロワーと差が出うる）。厳密な投稿時点スナップショットが要るかは実装時に判断（現状は許容。[../processing-model.md](../processing-model.md) §9）
- まとめ表示（「〇〇さん他 3 人がフォローしました」）→ 将来
- 非公開化に伴う通知の取り消し → 実装時に確定
- プッシュ通知・メール通知は対象外（将来）
