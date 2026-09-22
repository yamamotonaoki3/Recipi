# プロフィール

## 1. 目的・概要

ユーザーの表示名・自己紹介文・アバター画像・連絡先/SNS リンクを管理する。他ユーザーはプロフィール画面で表示名・自己紹介文・フォロー状況・公開設定された連絡先・その人の公開レシピを見られる。退会はマイページから行い、アカウントと投稿レシピを復帰可能な状態で保持する。

自分のプロフィールの入口はボトムナビゲーション / ナビゲーションレールの「マイページ」destination（[../screens/my-page.md](../screens/my-page.md)）。そこから「プロフィール編集」「アカウント設定」「自分のレシピ一覧」「フォロー・フォロワー」「ログアウト」に進む。他ユーザーのプロフィールは [../screens/user-profile.md](../screens/user-profile.md)。

**「プロフィール編集」と「アカウント設定」は役割で分ける**（Issue #242）:

- **プロフィール編集** = 他人への見せ方（表示名・自己紹介・アバター・SNS リンクと公開トグル）。パスワードは要らない。
- **アカウント設定** = 認証情報そのものの変更（秘密の質問・答え、メールアドレス）。**どちらも現在のパスワードで再認証してから**変更する共通の性質を持つため、専用画面にまとめる（[auth.md](auth.md) §8）。詳細は [../screens/my-page.md](../screens/my-page.md) §4。

## 2. 画面・UI

### プロフィール編集（自分）（[../screens/profile-edit.md](../screens/profile-edit.md)）

上から順に:

1. アバター画像（変更 / 削除ボタン。選ぶと切り抜きダイアログが開き、ドラッグ〈位置〉と＋/－〈拡大率 100〜400%〉で表示範囲を決めてから確定する。確定した範囲だけをクライアント側で切り抜いて送信し、サーバー側では切り直さない。Issue #251）
2. 表示名
3. 自己紹介文（空欄・改行可、最大 2,000 文字）
4. メールアドレス（値の表示 + 「プロフィールに表示する」トグル）
5. X の URL（+ トグル）
6. Instagram の URL（+ トグル）
7. その他の URL（+ トグル）
8. 保存ボタン

> ログアウト・アカウント削除はこの画面には置かない（マイページ側。[../screens/my-page.md](../screens/my-page.md)）。

#### アカウント削除の確認ダイアログ

- 「アカウントを削除すると、プロフィールは非表示になります。投稿したレシピは残り、投稿者は『アカウント削除済み』と表示されます。フォロー・お気に入り・感想・通知・閲覧履歴は削除されます。」
- 「削除する」/「キャンセル」。削除実行でログイン画面へ。

### ユーザープロフィール（他人）（[../screens/user-profile.md](../screens/user-profile.md)）

1. アバター + 表示名
2. 自己紹介文（未設定なら表示しない）
3. フォロー数 / フォロワー数（タップでフォロー・フォロワー画面の該当タブへ。対象はこのユーザー、[follow.md](follow.md)）
4. フォローボタン（フォロー / フォロー中）
5. 連絡先・SNS: **公開トグル ON の項目のみ**表示（メール / X / Instagram / その他 URL）
6. その人の公開レシピ一覧（レシピカード）

## 3. 振る舞い・ルール

- 表示名を変更すると、以後の自分の投稿・一覧・プロフィール・感想の表示名に反映される。
- メール / X / Instagram / その他 URL には**項目ごとの公開トグル**がある。既定はすべて非公開（OFF）。
- 他ユーザーのプロフィール取得（`GET /users/{id}`）では、**公開トグル OFF の項目をレスポンスに含めない**。本人取得時のみ全項目 + 各トグル状態を返す（[non-functional.md](../non-functional.md) データ可視性ルール）。
- アバターの実体は S3 互換ストレージに保存（[image.md](image.md)）。`users.avatar_key` を記録し、表示用 URL はキーから生成する。
- 「秘密の質問・答え」はサインアップ時に登録する（[auth.md](auth.md)）。後からの変更はプロフィール編集ではなく、マイページの「アカウント設定」画面で行う（Issue #242。[auth.md](auth.md) §8）。
- **アカウント削除**（`DELETE /users/me`）:
  - 本人のみ。確認 UI 必須。
  - 削除は**単一のアプリケーショントランザクション**で `users.deleted_at` を設定する論理削除。削除前に `users.token_version` を原子的に `+1` し、本人の `follows`（両方向）・`favorites`・`recipe_comments`・`refresh_tokens`・`notifications`・`recipe_views`・未使用 `uploads` を明示削除する。
  - 本人のプロフィールは `GET /users/{id}` と `GET /users/{id}/recipes` で 404 にする。一方、公開レシピは残し、フィード・詳細・他ユーザーのお気に入りでは投稿者を「アカウント削除済み」と表示する。投稿者プロフィールへは遷移させない。非公開レシピも保持するが、再開まで閲覧不能。
  - 消える本人の感想画像と未使用アップロードだけを削除キューへ入れる。投稿レシピのサムネ・手順画像、アバター、他ユーザーの感想・お気に入りは残す。
  - 生き残るレシピ・他ユーザーのカウント列は同一トランザクションで減算する。デッドロックは `run_with_retry()` がやり直す。
  - 削除は成功時 204。既発行トークンは以降 401。ログイン時は正しい認証情報に限り 409 `ACCOUNT_DEACTIVATED` を返し、`POST /auth/reactivate` で明示的に再開する。プロフィール・アバター・レシピは復帰するが、削除済みのフォロー・お気に入り・感想・通知・閲覧履歴は復帰しない。

## 4. データモデル

`users` テーブル（プロフィール関連）:

| カラム | 型 | 制約 |
| --- | --- | --- |
| `display_name` | string | NOT NULL（1〜30 文字。空白だけは不可） |
| `bio` | varchar(2000) | NULL 可（空欄・改行可、最大 2,000 文字） |
| `avatar_key` | string | NULL 可 |
| `deleted_at` | timestamptz | NULL 可。非 NULL なら退会中 |
| `email_public` | boolean | NOT NULL DEFAULT false |
| `x_url` | string | NULL 可（URL 形式・2048 文字まで） |
| `x_public` | boolean | NOT NULL DEFAULT false |
| `instagram_url` | string | NULL 可（URL 形式・2048 文字まで） |
| `instagram_public` | boolean | NOT NULL DEFAULT false |
| `other_url` | string | NULL 可（URL 形式・2048 文字まで） |
| `other_public` | boolean | NOT NULL DEFAULT false |

CASCADE 経路は [data-model.md](../data-model.md)「アカウント削除時の CASCADE」参照。

## 5. API

### GET `/users/{id}`（認証必要）

```json
// 他人を取得（公開トグルON の項目だけ）
{
  "id": "…", "displayName": "テスト太郎", "bio": "お菓子作りが好きです。",
  "avatarUrl": "https://…",
  "followingCount": 12, "followerCount": 34,
  "isFollowing": true,
  "links": { "instagram": "https://instagram.com/…" }
}
// 本人を取得（全項目 + トグル状態）
{
  "id": "…", "displayName": "テスト太郎", "bio": "お菓子作りが好きです。", "email": "testuser_001@example.com",
  "avatarUrl": "https://…",
  "followingCount": 12, "followerCount": 34, "isFollowing": null,
  "emailPublic": false,
  "xUrl": null, "xPublic": false,
  "instagramUrl": "https://instagram.com/…", "instagramPublic": true,
  "otherUrl": null, "otherPublic": false
}
```

- 他人向けの補足（Issue #67 で確定）:
  - 公開トグル OFF の項目は `null` ではなく**キーごと含めない**。公開 ON でも値が無い項目もキーを出さない
  - `email` は `emailPublic` が ON のときだけキーを出す
  - `links` は**常に返す**（公開された SNS が無ければ `{}`）。キーは `x` / `instagram` / `other`
  - 公開トグルの状態（`emailPublic` など）や `xUrl` などの生の項目は、他人向けには一切含めない
  - `avatarUrl` は公開トグルの対象外なので常に返す（未設定なら `null`）

### PATCH `/users/me`（認証必要）

- body（すべて任意、送られた項目だけ更新）: `displayName`, `bio`, `emailPublic`, `xUrl`, `xPublic`, `instagramUrl`, `instagramPublic`, `otherUrl`, `otherPublic`
- 送らなかった項目は変更しない。URL に `null` を送ると削除。`displayName` と各トグルに `null` は 400
- 200（本人向けの設定一式）/ 400（形式エラー。1 項目でも不正なら何も書き換えない）

### PUT `/users/me/avatar`（認証必要、multipart）／ DELETE `/users/me/avatar`

- [image.md](image.md) 参照。

### DELETE `/users/me`（認証必要）

- 削除は成功時 204。削除に伴いアクセストークン・リフレッシュトークンが無効化されるため、以降の同トークンでのリクエストは 401。専用の冪等機構は設けない。
- 論理削除。投稿レシピは残し、本人の行動データだけを削除する

### POST `/auth/reactivate`（認証不要）

- body: `email`, `password`, `rememberMe`
- 退会中のアカウントだけを再開し、通常ログインと同じ認証レスポンスを返す。対象外または認証失敗は 401。

### GET `/users/{id}/recipes`（認証必要）

- 他人: 公開レシピのみ。本人: 非公開も含む。ページング（`limit` / `cursor`）。存在しないユーザーは 404。
- 1 件の形は `GET /users/me/recipes` と同じ（レシピカードの項目: `author`（アバター ＋ 表示名）・`favoriteCount`・`isPublic` ほか）。

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| displayName | 1〜30 文字。空白だけ（半角・全角とも）は不可 |
| bio | 空欄・改行可。最大 2,000 文字。空文字・空白だけは null 扱い |
| xUrl / instagramUrl / otherUrl | URL 形式（`http(s)://` で始まり空白を含まない）。2048 文字まで（文字数で数える）。空文字・空白だけは null 扱い。ドメイン許可リストは採らない（[todo.md](../todo.md) #14 で確定） |
| アバター画像 | [image.md](image.md) の共通ルール（形式・サイズ、1 枚、正方形推奨） |

## 7. 受け入れ基準

- [x] 表示名を変更すると、自分の投稿・一覧・感想の表示名に反映される（`backend/tests/test_profile.py::test_display_name_change_is_reflected_everywhere`。投稿詳細・フィード・自分のレシピ一覧・プロフィール・フォロー一覧への反映を確認。感想欄そのものの表示名反映は別テストでは確認できていない）
- [x] 表示名が空 / 31 文字以上だと 400（`backend/tests/test_profile.py::test_display_name_boundaries`、`backend/tests/test_users_me.py::test_update_display_name_length_boundary_returns_400`）
- [x] 自己紹介文を保存でき、本人・他人のプロフィールに改行を保って表示できる（`backend/tests/test_profile.py::test_bio_validation`〈本人・改行保持〉、`test_bio_is_visible_to_other_users`〈他人向け〉）
- [x] 自己紹介文が空欄なら未設定になり、2,001 文字以上だと 400（`backend/tests/test_profile.py::test_bio_validation`、`test_null_bio_clears_the_value`）
- [x] URL 項目に不正な文字列を入れると 400（`backend/tests/test_profile.py::test_url_validation`）
- [x] 公開トグル OFF の項目は、他人が `GET /users/{id}` しても返らない（`backend/tests/test_profile.py::test_public_profile_contains_only_public_items`）
- [x] 公開トグル ON にした項目だけが他人のプロフィール画面に表示される（API: `backend/tests/test_profile.py::test_public_profile_contains_only_public_items`、`test_public_toggle_on_without_value_has_no_key`。画面: `expoApp/src/screens/__tests__/UserProfileScreen.test.tsx::"表示名・自己紹介文・フォロー数・公開 ON の連絡先だけを出す"`）
- [x] アバターを設定 / 変更 / 削除でき、一覧カード・詳細・プロフィールに反映される（`backend/tests/test_avatar.py::test_set_avatar_saves_object_and_updates_profile`〈設定〉、`test_replace_queues_old_key`〈変更〉、`test_delete_avatar_queues_key_and_is_idempotent`〈削除〉、`test_avatar_url_is_reflected_everywhere`〈一覧・詳細・プロフィール等への反映〉）
- [x] アカウント削除の確認ダイアログを経ないと削除できない（`expoApp/src/screens/__tests__/MyPageScreen.test.tsx::"アカウント削除は確認後にだけ実行する"`）
- [x] アカウント削除後、公開レシピは残り投稿者が「アカウント削除済み」と表示され、プロフィールは開けない（`backend/tests/test_account_deletion.py::test_deactivate_account_keeps_recipes_and_fixes_counts`）
- [x] アカウント削除後、本人のフォロー・お気に入り・感想・通知・閲覧履歴が削除される（`backend/tests/test_account_deletion.py::test_deactivate_account_keeps_recipes_and_fixes_counts`。お気に入り・感想は本人行 0 件を直接確認、フォローは削除後に相手側のフォロー数が 0 に再計算されることで間接確認。通知は本人コメント紐づけ分のみ、閲覧履歴は件数の直接 0 確認はしていない）
- [ ] 退会済みアカウントを確認後に再開でき、プロフィール・レシピが復帰する
- [x] アカウント削除後、削除前に発行された既存のアクセストークンでリクエストすると 401 になる（`backend/tests/test_account_deletion.py::test_deactivate_account_keeps_recipes_and_fixes_counts`、`backend/tests/test_auth_login.py::test_deactivated_account_requires_explicit_reactivation`）

## 8. 未確定・メモ

- SNS URL のドメイン検証の厳格度 → [todo.md](../todo.md) #14
- アバターのデフォルト画像・トリミング UI → [todo.md](../todo.md) #15
- 退会ユーザーの感想の扱い（現状 CASCADE 削除）→ [comment.md](comment.md) / [../todo.md](../todo.md)
- ~~秘密の質問・答えの変更手段~~ → 確定: マイページの「アカウント設定」画面（Issue #242。[auth.md](auth.md) §8）
- メール変更フローは対象外（将来）
