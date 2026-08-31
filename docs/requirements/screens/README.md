# 画面設計

Recipi の画面構成・画面遷移・共通コンポーネント。要件（機能仕様）は [`../features/`](../features/) を正とし、この配下は**そこに書かれた機能を「どの画面で・どう並べて・どう遷移して」実現するか**を扱う。

## 読み方

1. [navigation.md](navigation.md) — 全体のナビゲーション構造（ボトムナビ / ナビゲーションレール）、画面の実装レイヤー図、バックスタック、認証ゲート
2. [components.md](components.md) — 画面をまたいで使う共通コンポーネントの定義
3. [transitions.md](transitions.md) — 全体遷移図 ＋ 主要フロー別の遷移図
4. 各画面ファイル（下表）

## 画面一覧

| 画面 | ファイル | 認証 | ボトムナビ |
| --- | --- | --- | --- |
| スプラッシュ | [splash.md](splash.md) | - | - |
| ログイン | [login.md](login.md) | 不要 | - |
| サインアップ | [signup.md](signup.md) | 不要 | - |
| パスワードリセット | [password-reset.md](password-reset.md) | 不要 | - |
| ホーム（4 サブタブ） | [home.md](home.md) | 必要 | ホーム |
| 検索 | [search.md](search.md) | 必要 | 検索 |
| 通知一覧 | [notifications.md](notifications.md) | 必要 | 通知 |
| レシピ作成 / 編集 | [recipe-editor.md](recipe-editor.md) | 必要 | ＋（作成） |
| マイページ | [my-page.md](my-page.md) | 必要 | マイページ |
| レシピ詳細 | [recipe-detail.md](recipe-detail.md) | 必要（アプリ方針。API は公開レシピを匿名可）／非公開は本人のみ | - |
| 自分のレシピ一覧 | [my-recipes.md](my-recipes.md) | 必要 | - |
| フォロー・フォロワー | [connections.md](connections.md) | 必要 | - |
| プロフィール編集 | [profile-edit.md](profile-edit.md) | 必要 | - |
| ユーザープロフィール（他人） | [user-profile.md](user-profile.md) | 必要 | - |

## 各画面ファイルの構成（テンプレート）

1. **目的**
2. **ナビゲーション** — 入口 / 出口 / 戻る挙動 / 認証要否
3. **レイアウト** — 上 → 下のコンポーネント列（[components.md](components.md) の共通部品を参照）
4. **状態** — loading / empty / error / 未認証 / 権限なし
5. **アクションと結果** — 操作 → 何が起きる / どこへ遷移 / 楽観更新の有無
6. **使用 API** — [`../api.md`](../api.md) の該当エンドポイント
7. **プラットフォーム差分** — モバイル / デスクトップ

## 他ドキュメントとの関係

- **機能仕様の正**: [`../features/*.md`](../features/)。画面設計と食い違ったら features を直す。
- **API の正**: [`../api.md`](../api.md) ＋ 各 `features/*.md` の「API」節。
- **データモデルの正**: [`../data-model.md`](../data-model.md)。
- **用語**: [`../glossary.md`](../glossary.md)。

最終更新: 2026-08-31
