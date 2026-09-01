# API 仕様（集約ビュー）

> 全体を一望するための集約ビュー。各エンドポイントの詳細・リクエスト例・エラーは該当する `features/*.md` を正とする。

## 共通仕様

- ベース URL: `/api/v1`
- 認証: `Authorization: Bearer <アクセストークン>`
- アクセストークンは短命。期限切れ時は `POST /auth/refresh` でリフレッシュトークンを使って更新（ローテーション方式。[features/auth.md](features/auth.md)）
- リクエスト / レスポンスは `application/json`（画像アップロードのみ `multipart/form-data`）
- **一覧系・感想スレッドはすべてカーソルページング**（`limit`, `cursor`）で、レスポンスに `nextCursor` を返す（無限スクロール）。オフセットページングは使わない
- ソートは `(時刻, id)` の全順序とし、`cursor` は両方を保持する
- 1 ページ 20 件目安
- 日時は ISO 8601（UTC）
- レスポンスの `thumbnailUrl` / `avatarUrl` / `imageUrl` は、サーバーが永続化されたオブジェクトキーから生成する表示用 URL（派生値）。署名付き URL はレスポンスごとに生成し、DB には永続化しない

### 統一エラーレスポンス

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "title must not be blank", "details": [] } }
```

代表的な `code`: `VALIDATION_ERROR` (400) / `UNAUTHORIZED` (401) / `FORBIDDEN` (403) / `NOT_FOUND` (404) / `CONFLICT` (409) / `TOO_MANY_REQUESTS` (429) / `INTERNAL` (500) / `AI_UNAVAILABLE` (503、AI プロバイダ障害・タイムアウト。[features/ai-proofread.md](features/ai-proofread.md))。

## エンドポイント一覧

### 認証 — [features/auth.md](features/auth.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/auth/signup` | 不要 | 登録（`email`, `password`, `displayName`, `securityQuestion`, `securityAnswer`）→ ユーザー + アクセス/リフレッシュトークン |
| POST | `/auth/login` | 不要 | ログイン（`email`, `password`, `rememberMe`）→ ユーザー + アクセス/リフレッシュトークン |
| POST | `/auth/refresh` | 不要（リフレッシュトークンを body で送る） | 新しいアクセス/リフレッシュトークンのペア。リユース検知でチェーン失効 |
| POST | `/auth/logout` | 必要 | リフレッシュトークン（チェーン）を失効 |
| POST | `/auth/password-reset/request` | 不要 | `email` → `{ securityQuestion }` |
| POST | `/auth/password-reset/confirm` | 不要 | `email` + `securityAnswer` + `newPassword` → 更新。429 で試行ロック |

### プロフィール — [features/profile.md](features/profile.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/users/{id}` | 必要 | プロフィール。公開トグル ON の項目のみ（本人取得時は全項目 + トグル状態）。`followingCount` / `followerCount`（カウント列）/ `isFollowing` |
| PATCH | `/users/me` | 必要 | `displayName`, `emailPublic`, `xUrl`, `xPublic`, `instagramUrl`, `instagramPublic`, `otherUrl`, `otherPublic` |
| PUT | `/users/me/avatar` | 必要 | アバター画像アップロード（multipart） |
| DELETE | `/users/me/avatar` | 必要 | アバター削除 |
| DELETE | `/users/me` | 必要 | アカウント削除。削除は成功時 204。削除に伴いアクセストークン・リフレッシュトークンが無効化されるため、以降の同トークンでのリクエストは 401。専用の冪等機構は設けない。関連データを CASCADE 削除 |
| GET | `/users/{id}/recipes` | 必要 | そのユーザーのレシピ一覧（他人には公開のみ、本人には非公開も） |

### レシピ — [features/recipe.md](features/recipe.md) / フィード = [features/home-feed.md](features/home-feed.md) / 検索 = [features/search.md](features/search.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/recipes` | 必要 | フィード / 検索。query: `feed=all\|following\|followers\|favorites`（既定 `all`）, `q`（`feed` と併用可、`favorites` 含む）, `limit`, `cursor` |
| GET | `/recipes/{id}` | 任意 | 詳細（非公開は本人のみ）。`isFavorited` / `favoriteCount` / `commentCount` / `author` / `thumbnailUrl` / `ingredientGroups[]`（各材料に `refRecipe`）/ `steps[].imageUrl` |
| POST | `/recipes` | 必要 | 作成。body に `ingredientGroups[]`（`{ name, ingredients: [{ name, quantity, unit, refRecipeId }] }`）, `thumbnailKey`（任意）, `steps[].imageKey`（任意） |
| PUT | `/recipes/{id}` | 必要 | 全項目更新（本人のみ）。材料グループ・材料・手順は配列で全入れ替え。`thumbnailKey` は省略 = 維持、`null` = 削除。手順画像を残す場合は既存の `steps[].imageKey` を再送 |
| DELETE | `/recipes/{id}` | 必要 | 削除（本人のみ）。自分の他レシピの材料がこのレシピを `ref_recipe_id` で参照していたら SET NULL |
| GET | `/users/me/recipes` | 必要 | 自分の投稿一覧（公開 / 非公開）。query: `q`（任意。タイトル + 材料名。マッチ規則は通常検索と同じ）, `limit`, `cursor`。材料の「レシピから選ぶ」ピッカーはこれを使う（自分のレシピ限定） |

一覧レスポンスの各要素には `favoriteCount`（`recipes.favorite_count`）/ `author`（id・表示名・アバター URL）/ `thumbnailUrl` を含める。

**材料グループ**: レシピは 1 個以上の材料グループを持つ（グループ未使用 = 名前なしグループ 1 つ = 見出しなしのフラット表示）。詳細は [features/recipe.md](features/recipe.md)。

**材料のレシピ参照**: `ingredients[].refRecipeId` を指定できるのは投稿者本人が所有するレシピのみ（自己参照不可、違反は 400）。レスポンスの `refRecipe` は `{ id, title }` / `{ id: null, title }`（参照先削除済み）/ `null`。

**検索マッチ規則（`q`）**: `q` を空白（半角・全角・連続）で語に分割 → 各語を個別に正規化 → 各語について `title_normalized` 部分一致 OR `ingredients.name_normalized` 部分一致 を AND。スペース無しは 1 語扱い。**材料グループ名（`ingredient_groups.name`）と `ingredients.ref_recipe_title` は検索対象外**。詳細は [features/search.md](features/search.md)。

### 閲覧履歴 — [features/view-history.md](features/view-history.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/recipes/{id}/view` | 必要 | 閲覧を記録（upsert `viewed_at = now()`）。繰り返し呼んでも安全だが毎回 `viewed_at` を更新するので厳密には冪等ではない。見えないレシピは 404。成功 204。クライアントはレシピ詳細取得成功後に非同期で 1 回呼ぶ |
| GET | `/users/me/history` | 必要 | 最近見たレシピ（`viewed_at DESC, recipe_id DESC`、カーソルページング）。可視性フィルタ `is_public OR author = me`。要素はレシピカード形状 ＋ `viewedAt` |
| DELETE | `/users/me/history` | 必要 | 閲覧履歴を全消去。成功 204 |

### 単位 — [features/unit.md](features/unit.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/units` | 任意 | 単位候補の一覧（`{ value, placement }` の配列。`placement` は `suffix` / `prefix`） |

登録専用エンドポイントは設けない。レシピ作成 / 更新時にサーバーが未登録 `unit` を正規化キーで判定し自動追加する（`placement` は `suffix`）。表示整形（`大さじ 2` / `200 g` / `少々`）は [features/unit.md](features/unit.md) の表示ルール。

### 画像 — [features/image.md](features/image.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/images` | 必要 | 画像 1 枚を一時アップロード（multipart）→ `{ key, url }`。サムネ / 手順画像 / 感想画像 共通 |
| PUT | `/users/me/avatar` | 必要 | アバター設定 / 差し替え（multipart） |
| DELETE | `/users/me/avatar` | 必要 | アバター削除 |

サムネ・手順画像・感想画像は `POST /images` で `key` を得て、レシピの `POST` / `PUT` body の `thumbnailKey` / `steps[].imageKey`、感想の `POST` / `PATCH` body の `imageKey` で紐付ける。キーは本人所有かつ未使用、または更新対象自身に紐付いているものに限り、他人のキー・別リソースのキーは 400。単一画像のサムネイル・感想画像は更新時にキー省略 = 変更なし、同じ既存キー = 維持、`null` = 削除、新しい未使用キー = 差し替え。全入れ替えの手順画像は、維持する既存キーを再送し、キーのない手順は画像なしとする。差し替え・削除で外れた旧画像はストレージ削除ジョブ対象。`recipe_images` エンドポイントは廃止。

### フォロー — [features/follow.md](features/follow.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/users/{id}/follow` | 必要 | フォロー（冪等）。自分自身は 400 |
| DELETE | `/users/{id}/follow` | 必要 | フォロー解除（冪等） |
| GET | `/users/{id}/following` | 必要 | そのユーザーがフォローしているユーザー一覧（カーソルページング）。各要素に閲覧者から見た `isFollowing` を含む |
| GET | `/users/{id}/followers` | 必要 | そのユーザーのフォロワー一覧（カーソルページング）。各要素に閲覧者から見た `isFollowing` を含む |
| GET | `/users/me/following` | 必要 | 自分がフォローしているユーザー一覧。`/users/{id}/following` に自分の ID を指定した場合と同義 |
| GET | `/users/me/followers` | 必要 | 自分のフォロワー一覧。`/users/{id}/followers` に自分の ID を指定した場合と同義 |

### お気に入り — [features/favorite.md](features/favorite.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/recipes/{id}/favorite` | 必要 | お気に入り登録（冪等）。公開レシピ or 自分の非公開レシピのみ |
| DELETE | `/recipes/{id}/favorite` | 必要 | お気に入り解除（冪等） |
| GET | `/users/me/favorites` | 必要 | お気に入り一覧（登録日時の新しい順）。`GET /recipes?feed=favorites` と同内容 |

### 感想（コメント） — [features/comment.md](features/comment.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/recipes/{id}/comments` | 任意 | 感想一覧（新しい順、カーソルページング / 無限スクロール） |
| POST | `/recipes/{id}/comments` | 必要 | 感想投稿。body に `body` ＋ `imageKey`（任意）。レシピ投稿者本人は 403、非公開レシピは 404 |
| PATCH | `/comments/{commentId}` | 必要 | 感想編集（投稿者本人のみ）。`body` / `imageKey`（省略 = 変更なし、同じ既存キー = 維持、`null` = 削除、未使用キー = 差し替え） |
| DELETE | `/comments/{commentId}` | 必要 | 感想削除（感想の投稿者 or レシピの投稿者）。感想画像もストレージ削除ジョブ対象 |

### 通知 — [features/notification.md](features/notification.md)

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/notifications` | 必要 | 通知一覧（新しい順、カーソルページング）。レスポンスに `unreadCount` も含む |
| GET | `/notifications/unread-count` | 必要 | 未読件数のみ（バッジ更新用、一覧を取らない場面） |
| POST | `/notifications/read` | 必要 | 既読化（`{ ids?: [...] }`、省略時は全既読） |

### AI — [features/ai-proofread.md](features/ai-proofread.md)（Phase 11）

| メソッド | パス | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/ai/proofread` | 必要 | レシピの誤字脱字チェック。body に `items: [{ id, kind, text }]`（`kind` = `title` / `description` / `step` / `ingredient`。`items` 200 件 / 各 `text` 2,000 字 / 合計 8,000 字 / `id` 64 字 まで）→ `suggestions: [{ id, original, corrected, changed, note? }]`。自動適用しない。入力上限超過 400 / レート制限 429 / プロバイダ障害・タイムアウト 503（`AI_UNAVAILABLE`） |

プロバイダ（`AI_PROVIDER` = `local` / `anthropic` / `stub`）はサーバー内部の切替で、リクエスト / レスポンス形は不変（[features/ai-proofread.md](features/ai-proofread.md) / [tech-stack.md](tech-stack.md)）。
