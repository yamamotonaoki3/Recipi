# レシピ CRUD

## 1. 目的・概要

レシピの作成・閲覧・編集・削除。レシピはタイトル・説明・何人分・材料・手順・**サムネイル画像（1 枚）**・**手順ごとの画像（各 1 枚・任意）**・公開フラグからなる。更新・削除は投稿者本人のみ。

関連: 単位は [unit.md](unit.md)、画像は [image.md](image.md)、感想は [comment.md](comment.md)、一覧フィードは [home-feed.md](home-feed.md)、検索は [search.md](search.md)。

## 2. 画面・UI

### レシピ詳細（見る）画面

上から順に（[../screens.md](../screens.md) にも記載）:

1. **サムネイル画像 1 枚**（無ければプレースホルダ）。※ 画像カルーセルは無い
2. タイトル
3. 投稿者行（アバター + 表示名 + フォローボタン。タップでユーザープロフィール）
4. メタ情報（何人分・投稿日）
5. ♡ ボタン + お気に入り数（[favorite.md](favorite.md)）
6. 説明
7. 材料リスト（材料名 ＋ 数量・単位。単位の前置 / 後置は [unit.md](unit.md) の表示ルール。例: `じゃがいも 3 個` / `砂糖 大さじ 2` / `塩 少々`）
8. 手順リスト（番号付き。各手順は本文 ＋ その手順の画像があれば画像を縦に表示）
9. 感想セクション（[comment.md](comment.md)）
- 本人が見ている場合、上部に「編集」「削除」

### レシピ作成・編集画面

**入力項目と UI・バリデーション**

| 項目 | UI | 必須 | バリデーション |
| --- | --- | --- | --- |
| サムネイル画像 | 端末のカメラ / ギャラリーから 1 枚選択。変更 / 削除可 | | [image.md](image.md) の形式・サイズ |
| タイトル | 単一行テキスト | ○ | 1〜120 文字 |
| 説明 | 複数行テキスト | | 0〜2000 文字 |
| 何人分 | 数値入力（ステッパー併設） | ○ | 整数 1〜99 |
| 材料（行リスト） | 1 行 =「材料名 / 数量 / 単位」。`+` で行追加、各行に削除ボタン、行の並べ替え可 | ○（1 行以上） | 材料名: 必須 1〜60 文字。数量: 任意、0 より大きい数値（小数可）。単位: 任意、自由入力 0〜20 文字（候補から選択も可、[unit.md](unit.md)） |
| 手順（行リスト） | 1 行 = 本文 ＋ **「画像を追加」ボタン**（その手順の画像 1 枚。差し替え / 削除可）。行頭に手順番号を自動表示。`+` で行追加、各行に削除ボタン、行の並べ替え可 | ○（1 行以上） | 本文: 必須 1〜1000 文字。画像: 任意、手順 1 行につき 1 枚 |
| 公開フラグ | トグル | ○ | 既定は非公開（OFF） |

**行編集の挙動（材料・手順共通）**

- `+` ボタンを押すと末尾に空行が追加され、入力フォーカスがそこへ移る。
- 各行の削除ボタンで行を削除する。削除後、手順の番号（`position`）は 1 起点の連番に振り直す。手順を削除するとその手順の画像も外れる。
- 並べ替えはドラッグまたは上下移動ボタンで行う（UI の最終形は実装時に決定）。並べ替え後も `position` を 1 起点の連番に正規化する。手順画像は手順に付いて一緒に動く。
- 保存時、本文が空の手順行はクライアント側で送信前に除外する。

### 自分のレシピ一覧

- レシピカードの 1 リスト（公開・非公開混在、非公開に「非公開」バッジ）。**カーソルページングによる無限スクロール**（[../non-functional.md](../non-functional.md)）。
- 空状態: 「まだレシピを投稿していません」

## 3. 振る舞い・ルール

| 操作 | 認証 | 認可 |
| --- | --- | --- |
| 作成 | 必要 | ログインユーザーが投稿者になる |
| 詳細 | 任意 | 公開レシピは誰でも。非公開は投稿者本人のみ（他人は 403 / 404） |
| 更新 | 必要 | 投稿者本人のみ（他人は 403） |
| 削除 | 必要 | 投稿者本人のみ（他人は 403）。関連する材料 / 手順 / お気に入り / 感想 / 通知も削除。サムネ・手順画像はストレージ削除ジョブ対象 |
| 自分の投稿一覧 | 必要 | 本人の公開 / 非公開すべて |

- `PUT` は全項目更新。材料・手順は送られた配列で**全入れ替え**。
- 画像は**先に `POST /images`（[image.md](image.md)）でアップロードして `key` を得て**、レシピの `POST` / `PUT` の body で `thumbnailKey` と各 `steps[].imageKey` に指定して紐付ける。
- サーバーは `title` から `title_normalized`、各材料 `name` から `name_normalized` を生成する（[search.md](search.md)）。
- サーバーは材料の `unit` のうち `units` 未登録のものを自動追加する（[unit.md](unit.md)）。
- 公開レシピの新規投稿時、投稿者のフォロワー全員に通知（[notification.md](notification.md) `followee_new_recipe`）。

## 4. データモデル

| テーブル | 主なカラム |
| --- | --- |
| `recipes` | `id` PK / `user_id` FK（CASCADE）/ `title`（1〜120）/ `title_normalized`（index）/ `description`（0〜2000）/ `servings` NOT NULL CHECK(1〜99) / `is_public` NOT NULL / `thumbnail_key` NULL / `thumbnail_url` NULL / `favorite_count` NOT NULL DEFAULT 0 / `comment_count` NOT NULL DEFAULT 0 / `created_at` / `updated_at` |
| `ingredients` | `id` PK / `recipe_id` FK（CASCADE）/ `name`（1〜60）/ `name_normalized`（index）/ `quantity` NUMERIC NULL CHECK(>0) / `unit` VARCHAR NULL / `position` / UNIQUE(`recipe_id`, `position`) |
| `steps` | `id` PK / `recipe_id` FK（CASCADE）/ `position` / `body`（1〜1000）/ `image_key` NULL / `image_url` NULL / UNIQUE(`recipe_id`, `position`) |

> `recipe_images` テーブルは廃止。画像は `recipes.thumbnail_*` と `steps.image_*` に統合。

## 5. API

### GET `/recipes/{id}`（認証任意）

- 公開レシピ: 誰でも。非公開: 本人のみ（他は 403 / 404）
- レスポンスに `author`（id / 表示名 / アバター URL）, `isFavorited`, `favoriteCount`, `commentCount`, `thumbnailUrl`, `ingredients[]`, `steps[]`（各 `body` と `imageUrl`）を含む

### POST `/recipes`（認証必要）

```json
{
  "title": "基本の肉じゃが",
  "description": "定番の和食",
  "servings": 4,
  "isPublic": true,
  "thumbnailKey": "uploads/ab12…",
  "ingredients": [
    { "name": "じゃがいも",   "quantity": 3,    "unit": "個" },
    { "name": "牛こま切れ肉", "quantity": 200,  "unit": "g" },
    { "name": "塩",           "quantity": null, "unit": "少々" }
  ],
  "steps": [
    { "position": 1, "body": "野菜を切る",   "imageKey": "uploads/cd34…" },
    { "position": 2, "body": "炒めて煮る",   "imageKey": null }
  ]
}
// response 201: 作成された recipe オブジェクト（id 付き）
```

- `thumbnailKey` は任意（null 可）。`steps[].imageKey` も任意（null 可）。
- `key` は事前に `POST /images`（[image.md](image.md)）で取得した一時アップロードのキー。サーバーが本参照として確定する。
- `title_normalized` / `name_normalized` はサーバー生成（クライアントは送らない）。

### PUT `/recipes/{id}`（認証必要、本人のみ）

- body は `POST` と同形式。材料・手順は配列で全入れ替え。画像は `thumbnailKey` / `steps[].imageKey` の指定に従って差し替え（省略 = 変更なし、`null` = 削除、実装時に確定 → [../todo.md](../todo.md)）。

### DELETE `/recipes/{id}`（認証必要、本人のみ）

- 204。関連レコードを CASCADE 削除。画像はストレージ削除ジョブ対象。

### GET `/users/me/recipes`（認証必要）

- 自分の公開 / 非公開レシピ一覧。ページング。

（フィード用 `GET /recipes` は [home-feed.md](home-feed.md) / [search.md](search.md)）

## 6. バリデーション

上記「入力項目」の表を正とする。サーバーでも同じ制約を適用し、複数エラーをまとめて返す。

## 7. 受け入れ基準

- [ ] 必須項目欠落 / 文字数超過は 400 になる
- [ ] 何人分が未入力・0 以下・範囲外だと 400 になる
- [ ] 材料 0 件 / 手順 0 件で作成しようとすると 400 になる
- [ ] 他人のレシピを更新 / 削除しようとすると 403 になる
- [ ] レシピ削除時に材料・手順・お気に入り・感想レコードが残らず、画像もストレージから消える（削除ジョブ対象になる）
- [ ] 手順 1 行入力後 `+` を押すと次の行が現れフォーカスが移る
- [ ] 材料・手順の行を削除でき、削除後に順序が詰められる
- [ ] 材料・手順を並べ替えると、その順序で保存・表示される（手順画像も一緒に動く）
- [ ] サムネイル画像を設定 / 変更 / 削除でき、詳細・一覧カードに反映される
- [ ] 各手順に画像を添付 / 削除でき、詳細で本文の下に縦に表示される（カルーセルは無い）
- [ ] 空の手順行を残して保存しても、その行は保存されない
- [ ] 非公開レシピは他人の詳細アクセスで見えない
- [ ] 自分のレシピ一覧で非公開に「非公開」バッジが付く
- [ ] 公開レシピを投稿すると、フォロワーに通知が届く
- [ ] 材料が `大さじ 2` / `200 g` / `少々` のように単位ルールどおり表示される
- [ ] 自分のレシピ一覧が無限スクロールで全件たどれる

## 8. 未確定・メモ

- 材料・手順の並べ替え UI（ドラッグ / 上下ボタン）の確定 → [../todo.md](../todo.md)
- `PUT` 時の画像キー省略 / null の意味（変更なし / 削除）の確定 → [../todo.md](../todo.md)
- 一時アップロード画像（未参照）の GC → [../todo.md](../todo.md)
- レシピの複製・下書き保存は対象外（将来）
