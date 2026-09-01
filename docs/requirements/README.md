# Recipi 要件定義書

Recipi は、手軽にレシピを登録・共有・検索できるアプリ。モバイルファーストで、**Android / iOS / デスクトップ（Windows・macOS）** に対応。フォロー / お気に入り / 感想 / 通知などの軽いソーシャル機能を持つ。

## ステータス

- **要件定義は継続中**。ユーザーのレビューで随時追記・修正する。完成扱いにしない。
- **MVP（初回リリース範囲）は未確定**。[roadmap.md](roadmap.md) の Phase 分けをもとに別途決定する。

## 読み方

1. [overview.md](overview.md) — 全体像・想定ユーザー・ユースケース・対象外・リリース段階
2. [glossary.md](glossary.md) — 用語の定義（先に目を通すと機能ドキュメントが読みやすい）
3. `features/` の各機能ドキュメント（下表）
4. 横断ドキュメント（[screens/](screens/) / [data-model.md](data-model.md) / [api.md](api.md) / [non-functional.md](non-functional.md)）

### 機能ドキュメント

| 機能 | ファイル |
| --- | --- |
| 認証（サインアップ / ログイン / ログアウト） | [features/auth.md](features/auth.md) |
| プロフィール（表示名 / アバター / SNS リンク / アカウント削除） | [features/profile.md](features/profile.md) |
| レシピ CRUD（作成 / 閲覧 / 編集 / 削除・作成編集画面） | [features/recipe.md](features/recipe.md) |
| 単位マスター（材料の単位候補） | [features/unit.md](features/unit.md) |
| ホームフィード（全体 / フォロー / フォロワー / お気に入りレシピ の 4 タブ） | [features/home-feed.md](features/home-feed.md) |
| レシピ検索（タイトル + 材料名） | [features/search.md](features/search.md) |
| 閲覧履歴（最近見たレシピ） | [features/view-history.md](features/view-history.md) |
| フォロー / フォロワー | [features/follow.md](features/follow.md) |
| お気に入り | [features/favorite.md](features/favorite.md) |
| 感想（コメント） | [features/comment.md](features/comment.md) |
| 通知（フォロー / お気に入り / 感想 / 新着） | [features/notification.md](features/notification.md) |
| 画像アップロード（サムネイル / 手順画像 / アバター） | [features/image.md](features/image.md) |

### 横断ドキュメント

| 内容 | ファイル |
| --- | --- |
| 技術スタック | [tech-stack.md](tech-stack.md) |
| アーキテクチャ・リポジトリ構成 | [architecture.md](architecture.md) |
| 画面設計（ナビゲーション / 共通コンポーネント / 画面遷移図 / 画面別） | [screens/](screens/)（索引: [screens/README.md](screens/README.md)） |
| データモデル（全体 ER 図・全テーブル定義） | [data-model.md](data-model.md) |
| API 一覧・共通仕様 | [api.md](api.md) |
| 非機能要件 | [non-functional.md](non-functional.md) |
| 開発ロードマップ / MVP 候補ライン | [roadmap.md](roadmap.md) |
| 未確定事項・要調査（TODO） | [todo.md](todo.md) |
| 学び・手直しの記録 | [../lessons-learned.md](../lessons-learned.md) |

## ドキュメントの関係

- **各 `features/*.md` がその機能の「正」**。仕様の詳細・受け入れ基準はここに書く。
- [data-model.md](data-model.md) と [api.md](api.md) は**集約ビュー**（全体を一望するためのまとめ）。記述が食い違った場合は `features/*.md` を正とし、集約ビューを直す。
- [screens/](screens/) は画面構成・ナビゲーション・画面遷移。各機能に固有の画面詳細は該当 `features/*.md` にも書く。機能仕様と食い違ったら `features/*.md` を正とする。

## 各機能ドキュメントの構成（テンプレート）

1. 目的・概要
2. 画面・UI
3. 振る舞い・ルール
4. データモデル
5. API
6. バリデーション
7. 受け入れ基準
8. 未確定・メモ

最終更新: 2026-09-02（ボトムナビは 5 destination = ホーム / 履歴 / ＋ / 通知 / マイページ。検索は独立 destination をやめ、ホーム画面上部の常時固定検索窓に。閲覧履歴を追加。アカウント関連は「マイページ」に集約）
