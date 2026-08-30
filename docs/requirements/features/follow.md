# フォロー / フォロワー

## 1. 目的・概要

気に入った投稿者を**片方向でフォロー**する（Twitter 型、承認不要）。フォロー中ユーザーの新着レシピはホームの「フォロー」タブに出る（[home-feed.md](home-feed.md)）。

## 2. 画面・UI

### フォロー操作の場所

- 他ユーザーのプロフィール画面のフォローボタン（[profile.md](profile.md)）
- フォロー・フォロワー画面のユーザー行のフォロー状態ボタン
- （任意）レシピ詳細の投稿者行のフォローボタン

### フォロー・フォロワー画面（1 画面・2 タブ）

- アカウントメニューの「フォロー・フォロワー」から開く。
- 上部タブ: **「フォロー中」「フォロワー」**。
  - 「フォロー中」= 自分がフォローしているユーザーの一覧。
  - 「フォロワー」= 自分をフォローしているユーザーの一覧。
- 各行 = ユーザー行（アバター + 表示名 + フォロー状態ボタン）。**カーソルページングによる無限スクロール**（[../non-functional.md](../non-functional.md)）。
- **行タップでそのユーザーのプロフィールへ**（そこにその人の公開レシピ一覧がある。[profile.md](profile.md)）。
- ユーザープロフィールのフォロー数 / フォロワー数タップでも、この画面（該当タブ選択状態）へ遷移。自分のプロフィールから遷移した場合は `GET /users/me/following` / `GET /users/me/followers`、他ユーザーのプロフィールから遷移した場合は `GET /users/{id}/following` / `GET /users/{id}/followers` を使い、プロフィールのユーザーの一覧を表示する。
- 空状態: 「まだ誰もフォローしていません」/「まだフォロワーがいません」。

## 3. 振る舞い・ルール

- **片方向フォロー**: A が B をフォローする操作は `follows` に `(A → B)` を 1 行作るだけ。B の操作・承認は不要。
- **相互フォローは自動では発生しない**が、B が別途 A をフォローすれば `(B → A)` も作られ、相互フォロー状態になる。
- 自分自身はフォローできない（400）。
- フォロー / フォロー解除は冪等（二重フォローしても 1 行、未フォローの解除も 204）。
- **ブロック機能・フォロー承認制は対象外（不要と確定）。**
- フォロー成立時、被フォロー者に通知（[notification.md](notification.md) `followed`）。
- 各ユーザーのフォロー数（そのユーザーがフォローしている人数）とフォロワー数（そのユーザーをフォローしている人数）を表示。**カウント列キャッシュ**（`users.following_count` / `users.follower_count`）を使い、集計クエリはしない。

### フォロー数 / フォロワー数の更新（トランザクション）

共通ルールは [../non-functional.md](../non-functional.md)「カウント列キャッシュのトランザクション方針」。

```sql
-- フォロー（A → B）
BEGIN;
INSERT INTO follows (follower_id, followee_id) VALUES (:a, :b) ON CONFLICT DO NOTHING;
-- 1行入ったときだけ、関与する2行を id 昇順でロックしてから更新する
SELECT id FROM users WHERE id IN (:a, :b) ORDER BY id FOR UPDATE;
UPDATE users SET following_count = following_count + 1 WHERE id = :a;
UPDATE users SET follower_count  = follower_count  + 1 WHERE id = :b;
COMMIT;

-- フォロー解除
BEGIN;
DELETE FROM follows WHERE follower_id = :a AND followee_id = :b;  -- 削除件数を確認
-- 1行消えたときだけ、関与する2行を id 昇順でロックしてから更新する
SELECT id FROM users WHERE id IN (:a, :b) ORDER BY id FOR UPDATE;
UPDATE users SET following_count = following_count - 1 WHERE id = :a;
UPDATE users SET follower_count  = follower_count  - 1 WHERE id = :b;
COMMIT;
```

- 同じユーザーへの同時フォローは `users` 行のロックで直列化される。**クライアントにエラーは返さず、再フォローも不要。**
- `deadlock` / `serialization_failure` が起きたら**サーバー側で**トランザクションを数回リトライする（クライアントには見せない）。
- ズレ検知のため、実数から数え直して補正する定期ジョブを用意する。

## 4. データモデル

`follows` テーブル:

| カラム | 型 | 制約 |
| --- | --- | --- |
| `follower_id` | uuid | FK → `users.id`（ON DELETE CASCADE） |
| `followee_id` | uuid | FK → `users.id`（ON DELETE CASCADE） |
| `created_at` | timestamptz | |

- PK(`follower_id`, `followee_id`)
- CHECK(`follower_id` <> `followee_id`)
- index(`followee_id`)（フォロワー逆引き・補正ジョブ用）

関連: `users.following_count` / `users.follower_count`（NOT NULL DEFAULT 0, CHECK >= 0。[../data-model.md](../data-model.md)）

## 5. API

### POST `/users/{id}/follow`（認証必要）

- `{id}` をフォロー。冪等。
- 204 / 400（自分自身）/ 401 / 404（存在しないユーザー）

### DELETE `/users/{id}/follow`（認証必要）

- フォロー解除。冪等。204。

### GET `/users/me/following`（認証必要）

- 自分がフォローしているユーザー一覧。`GET /users/{id}/following` の `{id}` に自分の ID を指定した場合と同義のショートカット。

```json
{ "items": [ { "id": "…", "displayName": "…", "avatarUrl": "…", "isFollowing": true } ], "nextCursor": null }
```

### GET `/users/me/followers`（認証必要）

- 自分をフォローしているユーザー一覧。`GET /users/{id}/followers` の `{id}` に自分の ID を指定した場合と同義のショートカット。
- 各要素の `isFollowing` = 閲覧者（認証ユーザー）が相手をフォローしているか（フォローバック判定に使う）。

### GET `/users/{id}/following`（認証必要）

- `{id}` のユーザーがフォローしているユーザー一覧。カーソルページング（`limit`, `cursor`）。
- レスポンス形式は `GET /users/me/following` と同じ。各要素の `isFollowing` = 閲覧者（認証ユーザー）がその要素のユーザーをフォローしているか。
- 200 / 401 / 404（存在しないユーザー）

### GET `/users/{id}/followers`（認証必要）

- `{id}` のユーザーをフォローしているユーザー一覧。カーソルページング（`limit`, `cursor`）。
- レスポンス形式は `GET /users/me/following` と同じ。各要素の `isFollowing` = 閲覧者（認証ユーザー）がその要素のユーザーをフォローしているか。
- 200 / 401 / 404（存在しないユーザー）

（フォロー数 / フォロワー数・`isFollowing` は `GET /users/{id}` に含む。[profile.md](profile.md)）

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| `{id}` | 存在するユーザー。フォロー操作で自分自身を指定した場合は 400 |

## 7. 受け入れ基準

- [ ] フォローすると相手のフォロワー数と自分のフォロー数が +1 される
- [ ] フォロー解除で -1 される
- [ ] 同じ相手を二重フォローしても 1 件のまま（冪等）
- [ ] 自分自身をフォローしようとすると 400
- [ ] 「フォロー中」「フォロワー」タブの一覧が実データと一致する
- [ ] 他ユーザーのプロフィールから、そのユーザーの「フォロー中」「フォロワー」一覧を閲覧できる
- [ ] 相互フォロー（双方が follow）が成立し、両者の一覧に相手が出る
- [ ] ユーザー行 / プロフィールからフォロー状態を切り替えられる
- [ ] フォロー・フォロワー一覧の名前をタップすると、その人のプロフィール（＝その人のレシピ一覧を含む）へ遷移する
- [ ] 同じユーザーへ同時にフォローが来てもカウントが正しい（エラーは返らない）
- [ ] フォローされると被フォロー者に通知が届く

## 8. 未確定・メモ

- カウント補正ジョブの実行頻度、サーバー側リトライの上限回数 → [../todo.md](../todo.md) #10
- フォロー時通知の詳細は [notification.md](notification.md)
