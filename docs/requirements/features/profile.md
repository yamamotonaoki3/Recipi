# プロフィール

## 1. 目的・概要

ユーザーの表示名・アバター画像・連絡先/SNS リンクを管理する。他ユーザーはプロフィール画面で表示名・フォロー状況・公開設定された連絡先・その人の公開レシピを見られる。プロフィール編集画面からアカウント削除もできる。

自分のプロフィールの入口はボトムナビゲーション / ナビゲーションレールの「マイページ」destination（[../screens/my-page.md](../screens/my-page.md)）。そこから「プロフィール編集」「自分のレシピ一覧」「フォロー・フォロワー」「ログアウト」に進む。他ユーザーのプロフィールは [../screens/user-profile.md](../screens/user-profile.md)。

## 2. 画面・UI

### プロフィール編集（自分）（[../screens/profile-edit.md](../screens/profile-edit.md)）

上から順に:

1. アバター画像（変更 / 削除ボタン）
2. 表示名
3. メールアドレス（値の表示 + 「プロフィールに表示する」トグル）
4. X の URL（+ トグル）
5. Instagram の URL（+ トグル）
6. その他の URL（+ トグル）
7. 保存ボタン
8. （区切り線）
9. **アカウント削除**ボタン（赤色）

> ログアウトはこの画面には置かない（マイページ側。[../screens/my-page.md](../screens/my-page.md)）。

#### アカウント削除の確認ダイアログ

- 「アカウントを削除すると、投稿したレシピ・フォロー・お気に入り・感想がすべて削除され、元に戻せません。」
- 「削除する」/「キャンセル」。削除実行でログイン画面へ。

### ユーザープロフィール（他人）（[../screens/user-profile.md](../screens/user-profile.md)）

1. アバター + 表示名
2. フォロー数 / フォロワー数（タップでフォロー・フォロワー画面の該当タブへ。対象はこのユーザー、[follow.md](follow.md)）
3. フォローボタン（フォロー / フォロー中）
4. 連絡先・SNS: **公開トグル ON の項目のみ**表示（メール / X / Instagram / その他 URL）
5. その人の公開レシピ一覧（レシピカード）

## 3. 振る舞い・ルール

- 表示名を変更すると、以後の自分の投稿・一覧・プロフィール・感想の表示名に反映される。
- メール / X / Instagram / その他 URL には**項目ごとの公開トグル**がある。既定はすべて非公開（OFF）。
- 他ユーザーのプロフィール取得（`GET /users/{id}`）では、**公開トグル OFF の項目をレスポンスに含めない**。本人取得時のみ全項目 + 各トグル状態を返す（[non-functional.md](../non-functional.md) データ可視性ルール）。
- アバターの実体は S3 互換ストレージに保存（[image.md](image.md)）。`users.avatar_key` を記録し、表示用 URL はキーから生成する。
- 「秘密の質問・答え」はサインアップ時に登録する（[auth.md](auth.md)）。プロフィール編集からの変更手段は未確定（→ [../todo.md](../todo.md)）。
- **アカウント削除**（`DELETE /users/me`）:
  - 本人のみ。確認 UI 必須。
  - 削除は**単一のアプリケーショントランザクション**で行う。削除前に `users.token_version` を原子的に `+1` する。CASCADE で削除される `follows` / `favorites` / `recipe_comments` に対応して、生き残る他ユーザーの `following_count` / `follower_count` と他レシピの `favorite_count` / `comment_count` を、同一トランザクション内で減算またはピンポイントに数え直してからコミットする。補正ジョブは多層防御であり、削除時の整合を後追いジョブ任せにしない（共通方針は [non-functional.md](../non-functional.md)「カウント列キャッシュのトランザクション方針」）。
  - 削除で本人の `recipes`（→ `ingredients` / `steps` / その `recipe` への `favorites` / `recipe_comments`）、`follows`（`follower_id` = me と `followee_id` = me の両方向）、`favorites`（`user_id` = me）、`recipe_comments`（`user_id` = me）、`refresh_tokens`（`user_id` = me）、`notifications`（`user_id` = me と `actor_id` = me）を CASCADE 削除。サムネ・手順画像・**感想画像**・アバターはストレージ削除ジョブ対象。
  - ストレージ上の画像（レシピ画像・アバター）はアプリ側で削除ジョブ対象にする。
  - 削除は成功時 204。既発行のアクセストークンは、認証ミドルウェアのユーザー存在チェック（および削除前の `token_version` 加算）により以降 401 になる。リフレッシュトークンは CASCADE 削除される。専用の冪等機構は設けない（トークン検証の共通方針は [auth.md](auth.md)）。

## 4. データモデル

`users` テーブル（プロフィール関連）:

| カラム | 型 | 制約 |
| --- | --- | --- |
| `display_name` | string | NOT NULL（1〜30 文字） |
| `avatar_key` | string | NULL 可 |
| `email_public` | boolean | NOT NULL DEFAULT false |
| `x_url` | string | NULL 可（URL 形式） |
| `x_public` | boolean | NOT NULL DEFAULT false |
| `instagram_url` | string | NULL 可（URL 形式） |
| `instagram_public` | boolean | NOT NULL DEFAULT false |
| `other_url` | string | NULL 可（URL 形式） |
| `other_public` | boolean | NOT NULL DEFAULT false |

CASCADE 経路は [data-model.md](../data-model.md)「アカウント削除時の CASCADE」参照。

## 5. API

### GET `/users/{id}`（認証必要）

```json
// 他人を取得（公開トグルON の項目だけ）
{
  "id": "…", "displayName": "テスト太郎",
  "avatarUrl": "https://…",
  "followingCount": 12, "followerCount": 34,
  "isFollowing": true,
  "links": { "instagram": "https://instagram.com/…" }
}
// 本人を取得（全項目 + トグル状態）
{
  "id": "…", "displayName": "テスト太郎", "email": "testuser_001@example.com",
  "avatarUrl": "https://…",
  "followingCount": 12, "followerCount": 34, "isFollowing": null,
  "emailPublic": false,
  "xUrl": null, "xPublic": false,
  "instagramUrl": "https://instagram.com/…", "instagramPublic": true,
  "otherUrl": null, "otherPublic": false
}
```

### PATCH `/users/me`（認証必要）

- body（すべて任意、送られた項目だけ更新）: `displayName`, `emailPublic`, `xUrl`, `xPublic`, `instagramUrl`, `instagramPublic`, `otherUrl`, `otherPublic`
- 200 / 400（形式エラー）

### PUT `/users/me/avatar`（認証必要、multipart）／ DELETE `/users/me/avatar`

- [image.md](image.md) 参照。

### DELETE `/users/me`（認証必要）

- 削除は成功時 204。削除に伴いアクセストークン・リフレッシュトークンが無効化されるため、以降の同トークンでのリクエストは 401。専用の冪等機構は設けない。
- 関連データを CASCADE 削除

### GET `/users/{id}/recipes`（認証必要）

- 他人: 公開レシピのみ。本人: 非公開も含む。ページング。

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| displayName | 1〜30 文字 |
| xUrl / instagramUrl / otherUrl | URL 形式（`http(s)://`）。空文字は null 扱い。厳格なドメイン検証の要否は [todo.md](../todo.md) |
| アバター画像 | [image.md](image.md) の共通ルール（形式・サイズ、1 枚、正方形推奨） |

## 7. 受け入れ基準

- [ ] 表示名を変更すると、自分の投稿・一覧・感想の表示名に反映される
- [ ] 表示名が空 / 31 文字以上だと 400
- [ ] URL 項目に不正な文字列を入れると 400
- [ ] 公開トグル OFF の項目は、他人が `GET /users/{id}` しても返らない
- [ ] 公開トグル ON にした項目だけが他人のプロフィール画面に表示される
- [ ] アバターを設定 / 変更 / 削除でき、一覧カード・詳細・プロフィールに反映される
- [ ] アカウント削除の確認ダイアログを経ないと削除できない
- [ ] アカウント削除後、そのユーザーのレシピ・フォロー・お気に入り・感想が残らない
- [ ] アカウント削除後、削除前に発行された既存のアクセストークンでリクエストすると 401 になる

## 8. 未確定・メモ

- SNS URL のドメイン検証の厳格度 → [todo.md](../todo.md) #14
- アバターのデフォルト画像・トリミング UI → [todo.md](../todo.md) #15
- 退会ユーザーの感想の扱い（現状 CASCADE 削除）→ [comment.md](comment.md) / [../todo.md](../todo.md)
- 秘密の質問・答えの変更手段（プロフィール編集に入れるか）→ [../todo.md](../todo.md)
- メール変更フローは対象外（将来）
