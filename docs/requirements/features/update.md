# 更新機能

## 1. 目的・概要

Recipiは未署名のWindows(.msi)/Android(.apk)で配布している（[tech-stack.md](../tech-stack.md)「ライセンス・費用」、[todo.md](../todo.md) #31。証明書は課題提出用のため取得しない）。自動更新の仕組みが無いため、利用者が新しいビルドの有無・入手方法を知る手段が無い。また、AWS環境は学習用のため常時稼働させず`terraform apply`/`destroy`を繰り返す運用（[infra/terraform/README.md](../../../infra/terraform/README.md)）のため、backendが落ちている間にアプリを触ると原因不明の失敗に見える問題もある。

これらに対応するため、GitHub Releaseを使ってアプリのバージョン確認・新版通知・配布物への導線を提供する。**MVP対象外の追加機能**（[roadmap.md](../roadmap.md)のPhase表には含まれない、Phase外の機能）。

3段階に分けて実装する:

- **Stage 1**（本ドキュメントの§2〜§4）: アプリ情報画面とGitHub Release詳細ページへの導線。
- **Stage 2**: GitHub Releaseの新版検出・通知、およびbackend接続不能の警告UI（別PRで追記）。
- **Stage 3**: 「更新する」操作からの`.msi`/`.apk`配布URL連携と、GitHub Actionsによるリリース自動化（別PRで追記）。

## 2. 画面・UI（Stage 1）

- **ログイン画面**に「アプリ情報」リンクを追加する（認証不要で開ける）。
- **アプリ情報画面**（`/app-info`）: アプリ名・現在のバージョン・「更新を確認」ボタン（Stage 1では非活性）・「リリース内容を見る」ボタンを表示する。
- 「リリース内容を見る」は、GitHub Release詳細ページ（最新版）を外部ブラウザで開く。

## 3. 振る舞い・ルール（Stage 1）

- アプリ情報画面は**認証・セッションに依存せず単独で動作する**（未ログイン・backend停止中でも開ける）。
- 現在のバージョンは、Web/Android は`expo-constants`（`app.json`の`version`）、Tauri（デスクトップ）は`@tauri-apps/api/app`の`getVersion()`（`tauri.conf.json`の`version`）から取得する。**この4ファイル（`app.json`/`package.json`/`tauri.conf.json`/`Cargo.toml`）のバージョンは手動で同時管理する**（自動同期の仕組みは作らない。Stage 3のCIで整合性を検証する）。
- GitHub owner/repo・Release URLは環境変数（`EXPO_PUBLIC_GITHUB_OWNER`/`EXPO_PUBLIC_GITHUB_REPO`）から読み、バックエンドAPIの設定とは完全に別系統で管理する（開発・デモ・テスト用API URLが混入しない）。
- 外部URLを開く処理は、Web/Androidは`Linking.openURL`、Tauriは`@tauri-apps/plugin-opener`の`openUrl()`を使う（TauriのWebView内では`window.open()`が既定でブロックされ`Linking.openURL`だけでは開けないため）。起動に失敗してもアプリはクラッシュさせない。

## 4. 内部設計（Stage 1）

`expoApp/src/features/appUpdate/`配下に段階的に拡張する:

- `config.ts` — GitHub owner/repo・Release URL・現在バージョン取得を一元管理。
- `types.ts` — `ReleaseInfo`/`UpdateState`の型定義（Stage 1では型のみ、実データはStage 2で埋まる）。
- `openExternal.ts` — 外部URL起動のプラットフォーム差異吸収。

## 5. 受け入れ基準（Stage 1）

- [x] ログイン画面からアプリ情報を開ける。
- [x] 現在のバージョンが正しく表示される。
- [x] 「リリース内容を見る」で正しいGitHub Release詳細ページが開く。
- [x] Windows/Web/Androidでリンク起動処理がクラッシュしない。
- [x] バックエンド停止中・未ログインでもアプリ情報を表示できる。
- [x] 開発・デモ・テスト用API URLや秘密情報がRelease URL設定へ混入しない。
- [x] 既存のログイン、通知、画面遷移に回帰がない。

## 6. Stage 2・3（今後追記）

- Stage 2: GitHub Release更新検出・通知、backend接続不能警告（Issue #318）。
- Stage 3: 未署名インストーラー連携、GitHub Actionsによるリリース自動化（Issue #319）。
