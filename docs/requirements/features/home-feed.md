# ホームフィード（4 タブ）

## 1. 目的・概要

ログイン後の中心画面。ボトムナビゲーション（モバイル）/ ナビゲーションレール（デスクトップ）の「ホーム」destination（[../screens/navigation.md](../screens/navigation.md)）。4 つのサブタブでレシピのフィードを切り替えて表示する。

## 2. 画面・UI

- 画面設計は [../screens/home.md](../screens/home.md)
- アプリバー: ロゴ ＋ 右に**履歴アイコン**（[閲覧履歴](view-history.md)へ）。そのすぐ下に**常時固定の検索窓**（独立した「検索」destination は無い。マッチ規則は [search.md](search.md)）
- サブタブ: **全体 / フォロー / フォロワー / お気に入りレシピ**
- 本文: レシピカード（[../screens/components.md](../screens/components.md)）の縦リスト。**カーソルページングによる無限スクロール**（[../non-functional.md](../non-functional.md)）
- レシピ作成はボトムナビの「＋」（[../screens/recipe-editor.md](../screens/recipe-editor.md)）。画面内 FAB は置かない

| タブ | 表示内容 |
| --- | --- |
| 全体 | すべての公開レシピを新着順 |
| フォロー | 自分がフォローしているユーザーの公開レシピを新着順 |
| フォロワー | 自分をフォローしているユーザーの公開レシピを新着順 |
| お気に入りレシピ | 自分がお気に入り登録したレシピを、お気に入り登録日時の新しい順（[favorite.md](favorite.md)） |

> タブ名は「お気に入り」ではなく **「お気に入りレシピ」**（フォロー / フォロワーが人ベースなのと区別し、中身がレシピ一覧であることを明確にする）。

**空状態**

- フォロー: フォロー 0 のとき「気になる投稿者をフォローすると、ここに新着レシピが並びます」
- フォロワー: フォロワー 0 のとき「フォロワーが増えると、その人のレシピがここに並びます」
- お気に入りレシピ: お気に入り 0 のとき「お気に入りに追加したレシピがここに表示されます」

## 3. 振る舞い・ルール

- 全体 / フォロー / フォロワータブは**公開レシピのみ**（非公開は出さない。[../non-functional.md](../non-functional.md)）。
- お気に入りレシピタブは [favorite.md](favorite.md) のルールに従う（自分の非公開レシピは表示、他人のレシピで非公開化 / 削除済みは除外）。
- 全体 / フォロー / フォロワーは新着順（`recipes.created_at DESC`）。お気に入りレシピは `favorites.created_at DESC`。いずれもカーソルページング。
- フォロー / フォロー解除・お気に入りの増減の結果は、次にタブを表示（再取得）したときに反映。リアルタイム更新はしない。
- 検索はホーム画面最上部の**常時固定の検索窓**（[../screens/home.md](../screens/home.md) / マッチ規則は [search.md](search.md)）で行う。検索語は**表示中のサブタブ**の `feed` と併用され、その集合の中を絞り込む（`all` / `following` / `followers` / `favorites` すべて対象）。お気に入りレシピを表示中なら、自分がお気に入り登録したレシピ集合の中を絞り込む。
- お気に入りレシピは独立画面ではなくこのサブタブに一本化（マイページのメニューにも置かない。[../screens/my-page.md](../screens/my-page.md)）。

## 4. データモデル

新規テーブルなし。`recipes` / `follows` / `favorites` を参照。

- フォロータブ: `follows` で `follower_id` = me の `followee_id` 集合に属する公開レシピ。
- フォロワータブ: `follows` で `followee_id` = me の `follower_id` 集合に属する公開レシピ。
- お気に入りレシピタブ: `favorites` で `user_id` = me の `recipe_id` 集合（[favorite.md](favorite.md) の可視性ルール適用）。

## 5. API

### GET `/recipes`（認証必要）

| query | 説明 |
| --- | --- |
| `feed` | `all`（既定）/ `following` / `followers` / `favorites` |
| `q` | 検索語（ホームの検索窓。[search.md](search.md)）。全 `feed`（`favorites` を含む）と併用可。空なら通常フィード |
| `limit` / `cursor` | ページング |

```json
// response 200
{
  "items": [
    {
      "id": "…", "title": "肉じゃが", "thumbnailUrl": "https://…",
      "author": { "id": "…", "displayName": "テスト太郎", "avatarUrl": "https://…" },
      "favoriteCount": 12
    }
  ],
  "nextCursor": "…"
}
```

- `feed=favorites` は `GET /users/me/favorites`（[favorite.md](favorite.md)）と同じ内容を返す。
- `isFollowing` / `favoriteCount` などは N+1 を避けてまとめて取得（[../non-functional.md](../non-functional.md)）。`favoriteCount` は `recipes.favorite_count`（カウント列キャッシュ）。

## 6. バリデーション

| 項目 | ルール |
| --- | --- |
| `feed` | `all` / `following` / `followers` / `favorites` のいずれか。不正値は 400 |
| `limit` | 1〜50（既定 20） |

## 7. 受け入れ基準

- [ ] 「全体」に全ユーザーの公開レシピが新着順で出る（非公開は出ない）
- [ ] 「フォロー」に、フォロー中ユーザーの公開レシピだけが出る
- [ ] 「フォロワー」に、自分をフォローしているユーザーの公開レシピだけが出る
- [ ] 「お気に入りレシピ」に、自分がお気に入り登録したレシピが登録日時順で出る（自分の非公開レシピも含む）
- [ ] フォロー / お気に入りの増減の結果が、次回タブ表示（再取得）に反映される
- [ ] 検索窓に語を入れると、表示中のサブタブの集合の中だけで絞り込まれる。空にすると通常フィードに戻る
- [ ] 各タブはページングで全件たどれる
- [ ] フォロー 0 / フォロワー 0 / お気に入り 0 のとき、それぞれ空状態メッセージが出る

## 8. 未確定・メモ

- 「フォロー」「フォロワー」両方に出るレシピ（相互フォロー相手の投稿）の重複はタブが別なので問題なし。
- 並び順に「人気順」を将来追加するか → 将来
