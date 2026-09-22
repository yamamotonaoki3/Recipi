# 更新機能

## 1. 目的・概要

Recipiは未署名のWindows(.msi)/Android(.apk)で配布している（[tech-stack.md](../tech-stack.md)「ライセンス・費用」、[todo.md](../todo.md) #31。証明書は課題提出用のため取得しない）。自動更新の仕組みが無いため、利用者が新しいビルドの有無・入手方法を知る手段が無い。また、AWS環境は学習用のため常時稼働させず`terraform apply`/`destroy`を繰り返す運用（[infra/terraform/README.md](../../../infra/terraform/README.md)）のため、backendが落ちている間にアプリを触ると原因不明の失敗に見える問題もある。

これらに対応するため、GitHub Releaseを使ってアプリのバージョン確認・新版通知・配布物への導線を提供する。**MVP対象外の追加機能**（[roadmap.md](../roadmap.md)のPhase表には含まれない、Phase外の機能）。

3段階に分けて実装する:

- **Stage 1**（本ドキュメントの§2〜§4）: アプリ情報画面とGitHub Release詳細ページへの導線。
- **Stage 2**（本ドキュメントの§7〜§9）: GitHub Releaseの新版検出・通知、およびbackend接続不能の警告UI。
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

## 6. Stage 3（今後追記）

- 未署名インストーラー連携、GitHub Actionsによるリリース自動化（Issue #319）。

## 7. 画面・UI（Stage 2）

- **更新通知バナー**: 新Releaseを検出すると、「更新する」「リリース内容を見る」「後で」の3操作を表示する。既存のサーバー通知一覧（[notification.md](notification.md)）とは別系統（GitHubから取得した更新状態）。「更新する」の実際のインストーラー連携はStage 3で実装する。
- **backend接続不能警告ダイアログ**: 「再試行」「更新を確認」「後で確認」の3操作。「後で確認」で閉じても、接続不能状態が続く間は画面上部の警告バーで示し続ける。API復旧で警告は自動的に解除される。
- **アプリ情報画面**: 「更新を確認」ボタンが活性化し、押下時にGitHub Release APIを実際に確認して結果（最新版／新版あり／確認失敗）を画面に表示する。

## 8. 振る舞い・ルール（Stage 2）

- **更新検出**: アプリ起動時（ルートレイアウトのマウント時）に1回、バックグラウンドでGitHub Releaseの最新版を確認する。アプリ情報画面の「更新を確認」からも任意のタイミングで確認できる。現在バージョンと最新版をSemVerで比較し、新しいReleaseがある場合だけ更新状態を表示する。GitHub APIの通信失敗・レート制限・不正レスポンスではアプリをクラッシュさせず、更新通知を表示しない（`checkFailed`）。
- **「後で」の抑制**: 「後で」を選んだReleaseのバージョンは、同一起動中だけ覚え（永続化しない）、同じバージョンの通知を再表示しない。次回起動時・アプリ情報画面からは再確認できる。
- **backend接続不能の判定**（新規health check APIは追加しない）:
  - 既存の`api`クライアント（`client.ts`）の`onError`/`onResponse`ミドルウェアで判定する。
  - `onError`（raw fetch自体が例外を投げた＝真の意味で「backendに届かない」状態）: 端末がオンライン（`onlineManager.isOnline()`）のときだけ接続不能とみなす。端末オフライン時は既存の`OfflineBanner`が担当するため二重に判定しない。
  - `onResponse`で応答が502/503/504（ゲートウェイは動いているがbackend本体が応答不能）のときも接続不能とみなす。それ以外の応答（2xx、400/401/403/404/409/422/429等の正常な業務エラー）はbackendが応答できている証拠として「接続良好」に戻す。
  - 「再試行」ボタンは、既存の未使用hook`useHealth()`（`/healthz`を呼ぶ）の`refetch()`を呼ぶ。成功すれば上記の`onResponse`判定を通じて自動的に「接続良好」に戻る。
- **表示場所**: 更新通知・接続不能警告は、ルートレイアウト（`src/app/_layout.tsx`、`OfflineBanner`と同じ場所）に置き、未ログイン画面でも表示される。backend接続不能はログイン試行自体を失敗させるため、未ログインの利用者にこそ警告が必要（ログイン後のみマウントされるレイアウトには置かない）。
- 接続不能時も、既存のTanStack Queryのキャッシュ済み画面は引き続き閲覧できる（既存挙動を変更しない）。新Releaseがある場合でも更新を強制しない。

## 9. 内部設計（Stage 2）

`expoApp/src/features/appUpdate/`配下に追加:

- `api.ts` — `checkForUpdate()`。GitHub Release APIを`fetch`で直接呼ぶ（backend非依存）。
- `backendReachability.ts` — `markUnreachable()`/`markReachable()`を持つzustandストア。`client.ts`からのみ呼ばれる一方向依存。
- `updateDismissal.ts` — 「後で」を選んだバージョンを覚えるzustandストア（永続化しない）。
- `AppUpdateGate.tsx` — 更新通知・接続不能警告を統合し、ルートレイアウトに1つだけ置くコンポーネント。

`expoApp/src/api/client.ts`の既存ミドルウェア（`onError`/`onResponse`）に、`backendReachability`への通知を追加（既存の401リトライロジックには手を加えない）。

## 10. 受け入れ基準（Stage 2）

- [x] 新Releaseがない場合、更新通知が表示されない。
- [x] 新Releaseがある場合、更新情報と3つの操作が表示される。
- [x] 「後で」で同一起動中に更新通知が再表示されない。
- [x] GitHub通信失敗時にアプリがクラッシュせず通常利用を継続できる。
- [x] バックエンド停止時に接続不能警告が表示される。
- [x] 「再試行」「更新を確認」「後で確認」が機能する。
- [x] 接続不能時もキャッシュ済み画面を閲覧できる（既存挙動を変更していないため回帰なし）。
- [x] レシピ登録・編集などのAPI操作で適切な通信エラーが表示される（既存の画面ごとのエラー表示を変更していないため回帰なし）。
- [x] API復旧後に警告が解除される。
- [x] 未ログイン・バックエンド停止中でもGitHub Release確認が動作する。
