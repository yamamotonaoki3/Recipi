# Recipi 要件定義書

Recipi は、手軽にレシピを登録・共有・検索できるアプリ。モバイルファーストで、**Android / iOS / デスクトップ（Windows・macOS）** に対応。フォロー / お気に入り / 感想 / 通知などの軽いソーシャル機能を持つ。

## ステータス

- **要件定義は継続中**。ユーザーのレビューで随時追記・修正する。完成扱いにしない。
- **MVP（初回リリース範囲）は未確定**。[roadmap.md](roadmap.md) の Phase 分けをもとに別途決定する。

## 読み方

1. [overview.md](overview.md) — 全体像・想定ユーザー・ユースケース・対象外・リリース段階
2. [glossary.md](glossary.md) — 用語の定義（先に目を通すと機能ドキュメントが読みやすい）
3. `features/` の各機能ドキュメント（下表）
4. 横断ドキュメント（[screens.md](screens.md) / [data-model.md](data-model.md) / [api.md](api.md) / [non-functional.md](non-functional.md)）

### 機能ドキュメント

| 機能 | ファイル |
| --- | --- |
| 認証（サインアップ / ログイン / ログアウト） | [features/auth.md](features/auth.md) |
| プロフィール（表示名 / アバター / SNS リンク / アカウント削除） | [features/profile.md](features/profile.md) |
| レシピ CRUD（作成 / 閲覧 / 編集 / 削除・作成編集画面） | [features/recipe.md](features/recipe.md) |
| 単位マスター（材料の単位候補） | [features/unit.md](features/unit.md) |
| ホームフィード（全体 / フォロー / フォロワー / お気に入りレシピ の 4 タブ） | [features/home-feed.md](features/home-feed.md) |
| レシピ検索（タイトル + 材料名） | [features/search.md](features/search.md) |
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
| 画面一覧・共通コンポーネント・画面遷移図 | [screens.md](screens.md) |
| データモデル（全体 ER 図・全テーブル定義） | [data-model.md](data-model.md) |
| API 一覧・共通仕様 | [api.md](api.md) |
| 非機能要件 | [non-functional.md](non-functional.md) |
| 開発ロードマップ / MVP 候補ライン | [roadmap.md](roadmap.md) |
| 未確定事項・要調査（TODO） | [todo.md](todo.md) |

## ドキュメントの関係

- **各 `features/*.md` がその機能の「正」**。仕様の詳細・受け入れ基準はここに書く。
- [data-model.md](data-model.md) と [api.md](api.md) は**集約ビュー**（全体を一望するためのまとめ）。記述が食い違った場合は `features/*.md` を正とし、集約ビューを直す。
- [screens.md](screens.md) は画面の全体像と共通コンポーネント。各機能に固有の画面詳細は該当 `features/*.md` にも書く。

## 各機能ドキュメントの構成（テンプレート）

1. 目的・概要
2. 画面・UI
3. 振る舞い・ルール
4. データモデル
5. API
6. バリデーション
7. 受け入れ基準
8. 未確定・メモ

最終更新: 2026-08-31（レビュー反映第 2 回: 感想画像 / 全一覧・感想の無限スクロール / 単位の前置表記 placement / デスクトップ対応（Compose Multiplatform Desktop））
