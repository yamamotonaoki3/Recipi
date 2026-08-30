# お気に入り

## 1. 目的・概要

気になったレシピに「お気に入り（♡）」を付けて、後でまとめて見返せるようにする。お気に入りしたレシピはホームの「お気に入りレシピ」タブ（[home-feed.md](home-feed.md)）で一覧できる。

## 2. 画面・UI

- **レシピ詳細画面の ♡ ボタン**で登録 / 解除（トグル）。ボタン横にお気に入り数。
- レシピカード（[../screens.md](../screens.md)）にもお気に入り数を表示。
- **ホームの「お気に入りレシピ」タブ**が一覧（レシピカードの 1 リスト、お気に入り登録日時の新しい順）。
  - 空状態: 「お気に入りに追加したレシピがここに表示されます」。
- アカウントメニューに「お気に入りレシピ」項目は置かない（ホームのタブに一本化。[../screens.md](../screens.md)）。

## 3. 振る舞い・ルール

- **お気に入り可能な対象**:
  - 公開レシピ（誰のものでも）
  - **自分が投稿した非公開レシピ**（自分には見えるため）
  - 他人の非公開レシピは不可（404 相当）
- 登録 / 解除は冪等（二重登録しても 1 件、未登録の解除も 204）。
- お気に入り一覧には自分の非公開レシピも表示される。**他人のレシピ**が後から非公開化 / 削除されたら一覧に表示しない（`favorites` レコード自体は残してよい。[../non-functional.md](../non-functional.md)）。
- **お気に入り数はカウント列キャッシュ**（`recipes.favorite_count`）。集計クエリはしない。

### お気に入り数の更新（トランザクション）

共通ルールは [../non-functional.md](../non-functional.md)「カウント列キャッシュのトランザクション方針」。

```sql
-- 登録
BEGIN;
INSERT INTO favorites (user_id, recipe_id) VALUES (:u, :r) ON CONFLICT DO NOTHING;
-- 1行入ったときだけ
UPDATE recipes SET favorite_count = favorite_count + 1 WHERE id = :r;
COMMIT;

-- 解除
BEGIN;
DELETE FROM favorites WHERE user_id = :u AND recipe_id = :r;  -- 削除件数を確認
-- 1行消えたときだけ
UPDATE recipes SET favorite_count = favorite_count - 1 WHERE id = :r;
COMMIT;
```

- 同一レシピへの同時お気に入りは `recipes` 行のロックで直列化される（クライアントにエラーは返さない・再試行不要）。
- お気に入り成立時、レシピ投稿者に通知（[notification.md](notification.md) `recipe_favorited`）。ただし自分のレシピを自分でお気に入りしたときは通知しない。

## 4. データモデル

`favorites` テーブル:

| カラム | 型 | 制約 |
| --- | --- | --- |
| `user_id` | uuid | FK → `users.id`（ON DELETE CASCADE） |
| `recipe_id` | uuid | FK → `recipes.id`（ON DELETE CASCADE） |
| `created_at` | timestamptz | |

- PK(`user_id`, `recipe_id`)
- index(`recipe_id`)（逆引き・補正ジョブ用）

関連: `recipes.favorite_count`（NOT NULL DEFAULT 0, CHECK >= 0。[../data-model.md](../data-model.md)）

## 5. API

### POST `/recipes/{id}/favorite`（認証必要）

- お気に入り登録。冪等。204 / 401 / 404（存在しない、または他人の非公開レシピ）。

### DELETE `/recipes/{id}/favorite`（認証必要）

- お気に入り解除。冪等。204。

### GET `/users/me/favorites`（認証必要）

- お気に入り一覧（登録日時の新しい順）。ページング。
- 自分の非公開レシピは含む。他人のレシピで非公開化 / 削除済みのものは除外。
- レスポンス各要素はレシピカード相当（`id` / `title` / `thumbnailUrl` / `author` / `favoriteCount`）。
- ホームの「お気に入りレシピ」タブは `GET /recipes?feed=favorites` でも取得可（[home-feed.md](home-feed.md)）。同じ内容。

（`isFavorited` / `favoriteCount` はレシピ詳細・一覧レスポンスに含む。[recipe.md](recipe.md) / [home-feed.md](home-feed.md)）

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| `{id}` | 存在するレシピ。公開レシピ、または自分の非公開レシピのみ可（他は 404 相当） |

## 7. 受け入れ基準

- [ ] ♡ を押すとお気に入りに追加され、再度押すと解除される
- [ ] お気に入り一覧（＝ホームのお気に入りレシピタブ）に登録済みレシピが登録日時順で出る
- [ ] 自分の非公開レシピをお気に入りに追加でき、一覧に出る
- [ ] 他人の非公開レシピはお気に入りにできない（404）
- [ ] 二重登録しても 1 件のまま（冪等）
- [ ] 他人のレシピが非公開化 / 削除されたら一覧に出ない
- [ ] レシピ詳細・一覧カードのお気に入り数が実データと一致する
- [ ] 同時に複数人が同じレシピをお気に入りしてもカウントが正しい

## 8. 未確定・メモ

- お気に入りの並び替え（レシピ新着順など）→ 将来
- お気に入り解除時に `recipe_favorited` 通知を取り消すか → [notification.md](notification.md) / [../todo.md](../todo.md)
