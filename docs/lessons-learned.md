# 学び・手直しの記録

## 目的

Codex レビューで採用された指摘や実装中に発生した手直しを記録し、次回以降の計画と実装に活かす。

## 記録の索引

- [2026-08-31 要件定義書 PR #2 の Codex レビューで採用した指摘（設計チェックリスト）](#2026-08-31-要件定義書のcodexレビューで採用した指摘)
- [2026-08-31 画面設計 PR #7 の Codex レビューで採用した指摘](#2026-08-31-画面設計のcodexレビューで採用した指摘)
- [2026-09-01 材料リスト拡張 PR #9 の Codex レビューで採用した指摘](#2026-09-01-材料リスト拡張のcodexレビューで採用した指摘)
- [2026-09-01 バックエンド技術スタック変更（Ktor → FastAPI）の波及範囲](#2026-09-01-バックエンド技術スタック変更の波及範囲)
- [2026-09-01 複数フロントエンドトラックを要件に足すときの注意](#2026-09-01-複数フロントエンドトラックを要件に足すときの注意)
- [2026-09-01 ナビゲーション構成を変えるとき（検索 destination → ホームの検索窓）](#2026-09-01-ナビゲーション構成を変えるとき)
- [2026-09-01 サーバー保存の一覧機能を足すとき（閲覧履歴）](#2026-09-01-サーバー保存の一覧機能を足すとき)
- [2026-09-02 処理方式（トランザクション / 非同期 / バッチ）を横断で決めるとき](#2026-09-02-処理方式を横断で決めるとき)
- [2026-09-02 AI 機能を要件に足すとき（誤字脱字チェック）](#2026-09-02-ai-機能を要件に足すとき)
- [2026-09-03 環境変数ファイル・ローカル実行手順を作るとき](#2026-09-03-環境変数ファイルローカル実行手順を作るとき)
- [2026-09-04 backend の scaffold（FastAPI）を作るとき](#2026-09-04-backend-の-scaffold-を作るとき)
- [2026-09-04 frontend の scaffold（Expo）を作るとき](#2026-09-04-frontend-の-scaffold-を作るとき)
- [2026-09-05 ESLint を型情報ベースで厳格化するとき](#2026-09-05-eslint-を型情報ベースで厳格化するとき)
- [2026-09-05 認証（Issue #35）でトランザクション・同時実行制御を書くとき](#2026-09-05-認証issue-35でトランザクション同時実行制御を書くとき)
- [2026-09-06 認証画面（Issue #36）で frontend-ts の認証状態・セキュアストレージを書くとき](#2026-09-06-認証画面issue-36でfrontend-tsの認証状態セキュアストレージを書くとき)
- [2026-09-06 レシピ CRUD（Issue #37）で backend の書き込み API・検索を書くとき](#2026-09-06-レシピ-crudissue-37でbackendの書き込み-api検索を書くとき)
- [2026-09-07 レシピ画面（Issue #38）で frontend-ts のフォーム・一覧・ナビを書くとき](#2026-09-07-レシピ画面issue-38でfrontend-tsのフォーム一覧ナビを書くとき)
- [2026-09-07 CI のバージョン更新（Actions / JDK / Android API レベル）をするとき](#2026-09-07-ci-のバージョン更新をするとき)

- [2026-09-08 画像アップロード（Issue #39）で backend のストレージ・GC・削除キューを書くとき](#2026-09-08-画像アップロードissue-39でbackendのストレージgc削除キューを書くとき)
- [2026-09-09 画像 UI（Issue #40）で frontend-ts のピッカー・押下イベントを扱うとき](#2026-09-09-画像-uiissue-40でfrontend-tsのピッカー押下イベントを扱うとき)
- [2026-09-09 保存エラーのポップアップ（Issue #63）でスクロール移動を実装するとき](#2026-09-09-保存エラーのポップアップissue-63でスクロール移動を実装するとき)
- [2026-09-09 ホームフィード・検索・閲覧履歴（Issue #41）で backend の一覧 API・upsert・マイグレーションを書くとき](#2026-09-09-ホームフィード検索閲覧履歴issue-41でbackendの一覧-apiupsertマイグレーションを書くとき)
- [2026-09-10 ナビ・ホーム・履歴（Issue #42）で frontend-ts のタブシェルを組むとき](#2026-09-10-ナビホーム履歴issue-42でfrontend-tsのタブシェルを組むとき)
- [2026-09-10 Android のセーフエリア（Issue #74）で edge-to-edge の下端を扱うとき](#2026-09-10-android-のセーフエリアissue-74で-edge-to-edge-の下端を扱うとき)

---

## 2026-09-10 Android のセーフエリア（Issue #74）で edge-to-edge の下端を扱うとき

**きっかけ**: Issue #42 で追加した Android の MVP 通し E2E が、レシピエディタ末尾の「公開する」スイッチに到達できず 3 回続けて落ちた。**テストの問題ではなく実機で起きる製品不具合**だった。

1. **【最重要】edge-to-edge では上端だけでなく下端の inset も要る。しかも「画面ごと」ではなく「下に何が敷かれているか」で必要性が変わる**。`targetSdk 36` では画面がナビゲーションバーの裏まで広がる。避けないと ScrollView が「画面の下端まで自分の領域」と解釈し、**最下部までスクロールしてもコンテンツ末尾の約 48dp がバーの下から出てこない**（＝どう操作しても押せない。隠れた領域のノードは a11y ツリーからも剪定されるので E2E からも触れない）。タブ内の画面はボトムナビが `insets.bottom` を持つので画面側は不要だが、**タブシェルの外（モーダル・認証画面）は自分で確保しなければならない**。Issue #58 で上端を直したとき、下端は「ボトムナビで対応」とだけ書いてタブ外の画面を見落とした。

2. **不具合の証拠は、ロケータを変える前に取りに行く**。`wdio.conf.ts` の `afterTest` は以前から失敗時に page-source とスクリーンショットを `appium-wdio-log` という artifact に上げていた。`gh run download <run-id> -n appium-wdio-log` でスクリーンショットを **1 枚見れば「バーの下に隠れている」と即断できた**ものを、ロケータを 3 通り試して CI を 3 周（約 35 分）使った。**CI にデバッグ出力の仕組みが既にあるなら、まずそれを回収する**。

3. **「見つからない」は「無い」ではなく「見えていない」かもしれない**。`element wasn't found` を「ロケータが違う」とだけ読み、`resourceId` → `classNameMatches` → 生のスクロールジェスチャと、**探し方ばかり変えて配置を疑わなかった**。UiAutomator2 は可視ノードしか返さないので、この種のエラーはレイアウトの問題であることがある。

4. **CI のエミュレータが小さいことは欠点ではない**。既定プロファイル（320x640 dp）だったからこの不具合が表面化した。プロファイルを大きくすれば E2E は通るが、**実機で起きる不具合を隠すだけ**になる。狭い画面のまま通すこと。

5. **共通のテストモックが「無害な既定値」だと、抜けを検出できない**。`jest.setup.js` の `react-native-safe-area-context` モックは inset が全て 0 なので、`paddingBottom` を書き忘れても単体テストは緑のままだった。回帰を固定するテストでは、**その spec だけ inset を持つ端末に差し替える**（`jest.spyOn` はこの共通モックには効かず、ファイル単位の `jest.mock` で可変変数を読ませる必要があった。ファクトリは import より上に巻き上げられるため、変数名は `mock` で始めること）。

---

## 2026-09-10 ナビ・ホーム・履歴（Issue #42）で frontend-ts のタブシェルを組むとき

**きっかけ**: Issue #42（5 destination のナビゲーションシェル ＋ ホーム「全体」フィード ＋ 検索 ＋ 閲覧履歴 ＋ 通知/マイページのスタブ）。MVP ライン最後の Issue。

### expo-router の headless Tabs

1. **ボトムバー ⇔ ナビゲーションレールを切り替えるなら headless Tabs（`expo-router/ui`）を使う**。見た目つきの `Tabs` はバーが画面下に固定で、デスクトップ用の左レールにできない。headless 版は `<TabSlot />`（画面本体）と `<TabList />`（バー）を自分で並べられるので、**`<Tabs>` の `flexDirection` を入れ替えるだけ**で下バー ⇔ 左レールになる（`column` / `row-reverse`）。expo-router に同梱なので**追加の依存は不要**（`@react-navigation/bottom-tabs` を別途入れなくてよい）。
2. **子の順番は固定して方向だけ変える**。`[TabSlot, TabList]` の順を条件で入れ替えると画面がアンマウントされ、スクロール位置などの状態が飛ぶ。
3. **`TabList` 内の TabTrigger 以外の要素は「無視される」**（`Tabs.js` の `parseTriggersFromChildren` が明示的にスキップする）。これを利用して、中央の「＋」を素の `Pressable` にすればタブを増やさずにモーダルを開ける（navigation.md「タブ自体は選択状態にしない」）。
4. **トリガーの走査は Fragment と TabList の中しか降りない**。`<TabTrigger>` を自作コンポーネントで包むとタブとして認識されないので、`TabList` とその直下の `TabTrigger` は**ルートレイアウトに直接書く**。見た目の部品だけを別ファイルに切り出す。
5. **【実ブラウザで踏んだ】`TabTrigger asChild` の子は必ず `Pressable` にする**。`asChild` は Pressable 用の props（`onPress` 等）を子に流し込むので、受け側を `View` にすると `onPress` が無視され、**Web ではアンカーの既定動作だけが残ってページ全体がリロード**される（＝クライアント側のタブ遷移にならず、メモリ上のセッションが飛んでログイン画面に戻る）。jest では気づけず、DevTools の Network で document リクエストが増えることで発覚した。**タブ遷移は「document リクエストが増えないこと」で確認する**。

### destination ごとのスタック

6. **「詳細を開いてもタブバーを残す」には destination ごとに Stack を切る**。詳細をタブの外側の Stack に置くと全画面になりバーが消える（navigation.md の「各 destination は独立したナビゲーションスタックを保持する」に反する）。`(tabs)/home/_layout.tsx` のように各タブ配下に Stack を作り、`home/recipes/[id]` のようにその中へ push する。
7. **その結果、共有画面は 1 つの実装を複数のルートから使う形になる**。画面本体を `src/screens/` に置き（名前付き export）、各ルートファイルは 3 行の薄いラッパーにする。**push 先が destination で変わるので `basePath` を prop で渡す**（`/home` / `/history` / `/my-page`）。ハードコードした `/(app)/recipes/...` は別 destination のスタックへ飛んでしまう。
8. **URL が変わることを受け入れる**。グループ `(home)` `(history)` の両方に `recipes/[id]` を置くとルートが衝突するため、実ディレクトリ名（`/home`・`/history`）にする必要がある。ホームが `/` から `/home` になるので、`router.replace("/(app)")` を使っていた**ログイン / サインアップ / スプラッシュ / エディタの着地先を全部洗う**（`grep '"/(app)"'`）。

### テスト・E2E

9. **画面を作り替えると既存 E2E が全部巻き添えになる**。#42 では E2E 5 本すべてが仮ホームの `home-link-new-recipe` / `home-logout` /「ようこそ、〜さん」に依存していた。**新機能より先に既存 E2E の依存を `grep` で洗う**。着地確認は「ウェルカムメッセージ」のような仮の文言ではなく、`home-logo` のような恒久的な testID にしておくと次回壊れない。
10. **固定メールの E2E はローカルの開発 DB では 2 回目から落ちる**。CI は postgres コンテナを毎回作り直すので通るが、ローカルでは前回のユーザーが残って signup が失敗する。**ローカルで回す前に `DELETE FROM users WHERE email LIKE 'e2euser_%'`**（テストデータ規約の接頭辞がそのまま掃除条件になる）。
11. **レスポンシブの分岐は境界値そのものでテストする**。`useWindowDimensions` を `jest.mock("react-native/Libraries/Utilities/useWindowDimensions")` で差し替え、599 / 600 の 2 点を見る。定数（`NAV_RAIL_MIN_WIDTH`）を export してテストからも参照すると、値を変えたときにテストが自動で追随する。
12. **「描画のたびに呼ばない」は発火回数で担保する**。閲覧記録（`POST /recipes/{id}/view`）は取得成功後に 1 回だけ。ref で送信済み ID を控えるだけでなく、**ダイアログの開閉で再描画を起こしても呼び出し回数が 1 のまま**であることをテストに書く（lessons #40 の「発火回数はカウンタで測る」と同じ考え方）。
13. **`renderHook` も v14 では非同期**。lessons #40 の「`render` / `fireEvent` は必ず `await`」に `renderHook` も含まれる。`await` を忘れると `result` が `undefined` になり「Cannot read properties of undefined (reading 'current')」で落ちる。
14. **未解決の Promise をテストに残さない**。「送信中のリクエスト」を作るテストで、モジュールレベルの集合（`pendingViewRecords` のような）に Promise を積んだまま終わると、**同じファイルの後続テストがそれを待って軒並み落ちる**。必ず解決させてからテストを終える。

### 認証状態とキャッシュ（Codex レビューで繰り返し出た論点）

15. **認証必須のクエリは「セッション復元済み」でゲートする**。起動直後は保存済みトークンでの再ログイン中で、その間に投げると 401 → リフレッシュ失敗と見なされ、**まだ有効な保存済みリフレッシュトークンが消される**（ログインが飛ぶ）。`enabled: hydrated && isAuthenticated` を付ける。
16. **`QueryClient` はログアウトしても生き続ける**。消さないと「A が抜けた直後に B がログイン」で、stale time の内側は**再取得なしで A のデータが B の画面に出る**。破棄は `useLogout` に置くのではなく、**セッションストアを購読して状態変化を起点に**行う（トークン失効・`token_version` 不一致・アカウント削除では `client.ts` が直接セッションを消し、`useLogout` を通らない）。監視条件は「ログアウト（true→false）」だけでなく **ユーザー ID の変化**も含める（ログイン済みのまま別アカウントで入り直す経路がある）。
17. **fire-and-forget と破壊的操作が競合する**。閲覧記録は結果を待たないので、直後に「履歴を消去」すると**記録が DELETE より後に届いて 1 件だけ復活**する。送信中のリクエストを共有し、消去の前に `Promise.allSettled` で決着を待つ。

### E2E（Android）

18. **ローカルで再現できない E2E を、CI を回しながら推測で直さない**。エディタ末尾の公開スイッチが Android のツリーに出ない件で、`scrollIntoView(resourceId(...))` → `classNameMatches(".*Switch")` → 生の `mobile: scrollGesture` と 3 回、いずれも 11 分の CI を待って外した。このマシンでは `gradlew assembleRelease` が `react-native-worklets` の CMake で落ちて APK を作れず、手元で確認する手段が無いまま進めたのが原因。**検証手段が無いプラットフォーム向けに新しい E2E を書くと決めた時点で、先に検証手段を用意するか、そのシナリオを別 Issue に切ることを計画に入れる**（今回は Issue #74 に切り出した）。

19. **推測で直す前に、失敗メッセージへ `getPageSource()` を埋める**。3 回目にこれを入れて初めて事実が分かった（スクロールは効いている・ツリーの最後は `editor-add-step`・スクロール可能な要素は 1 つだけ・その中身のコンテナの `bounds` がビューポートと完全に一致）。ロケータを変えて試す前に、まず**画面の実際の状態を 1 回取りに行く**方が速い。

20. **「既存テストが通っている」は、その画面全体が触れることの保証ではない**。Android E2E 3 本はどれも `step-0-body` より下へスクロールしたことが無く、フォーム末尾は誰も触っていなかった。新しい導線を E2E に足すときは、**その画面で今まで一度も触られていない領域はどこか**を先に確かめる。

    > **訂正（Issue #74）**: この項目には当初「`recipe-crud.e2e.ts` の『ここで `scrollToId` を使うと UiScrollable が見つけられず失敗する』というコメントが同じ現象の回避策として残っていた」と書いていたが、**誤り**。あのコメントは `editor-save` が ScrollView の**外**の固定ヘッダーにあることについてのもので（スクロール領域の中に無いものを `UiScrollable` で探せば当然見つからない）、今回の不具合とは無関係だった。原因が分かる前に「それらしいコメント」を証拠として結び付けてしまった例。

---

## 2026-09-09 ホームフィード・検索・閲覧履歴（Issue #41）で backend の一覧 API・upsert・マイグレーションを書くとき

**きっかけ**: Issue #41（`GET /recipes?feed=all` ＋ 検索 ＋ `recipe_views` テーブル ＋ 履歴 3 API）。Codex レビュー 4 巡・指摘 4 件（P1×1・P2×3）で収束。

1. **共有テスト DB で「全レコード横断」の一覧をテストするときは、最後までページングして絞り込む**（Codex #41 P1）。`GET /recipes?feed=all` は全公開レシピが対象で、先行する CRUD 系テストが 20 件以上残すため「1 ページ目に自分の投稿分が全部入っている」前提は崩れる。`nextCursor` を最後までたどり、レスポンスの `author.displayName`（テストごとに一意な名前で signup）でこのテストの投稿分だけ拾うヘルパーを用意する。**`created_at` を未来日時に書き換えて「フィード先頭に来させる」のは NG** — 使い捨て DB でも 1 pytest セッション内で他テストに影響し、再実行のたびに未来レシピが累積してページ 1 を埋める。同 `created_at` のタイブレークを検証したいときは「そのバッチ内の最大 `created_at`」にそろえる（位置は変えない）。

2. **upsert の「最終更新時刻」は Python 時刻でも `now()` でもなく `GREATEST(既存値, clock_timestamp())`**（Codex #41 P2 ×2）。`recipe_views` の再閲覧は `viewed_at` を更新するが、(a) Python の `datetime.now()` はワーカー間の時計ずれがそのまま順序に出る、(b) `now()` はトランザクション開始時刻なので、同じ行に並行更新が来て「先に開始したトランザクションが行ロック解放を待って後から実行」されると、古い開始時刻で新しい閲覧を上書きし履歴順が逆転する。`func.greatest(RecipeView.viewed_at, func.clock_timestamp())` で単調更新にすると絶対に巻き戻らない。`on_conflict_do_update` の `set_` で `RecipeView.viewed_at` を書くと「既存行の値」を指す（挿入予定値は `stmt.excluded.viewed_at`）。

3. **PostgreSQL は FK 列を自動 index しない。ON DELETE CASCADE で親から引く列に index を明示する**（Codex #41 P2）。`recipe_views` は PK `(user_id, recipe_id)` だが `recipe_id` 単独の index が無いと 1 レシピ削除ごとに `recipe_views` 全体をスキャンする（表は閲覧のたびに増える）。junction テーブルは PK 第 2 カラム側にも index を張る（`favorites` は `index(recipe_id)` あり、`recipe_views` は data-model.md の記載漏れ → 実装で追加し doc も更新した）。

4. **backend CI は `ruff check` と `ruff format --check` の両方を回す**。`ruff check`（lint）だけ通しても `ruff format --check`（black 相当）で落ちる。着手時から両方かける。

5. **`alembic check` はこのプロジェクトでは合否判定に使えない**。全モデルが autogenerate と食い違う（`TIMESTAMP(timezone=True)` vs `DateTime()`、index 名の付き方など、既存の全テーブルで出る既知のノイズ）。CI は `alembic upgrade head` のみ。datetime 列の `timezone=True` はマイグレーション側だけで宣言する既存方針に合わせる（モデルの `Field` には付けない）。

6. **マイグレーションの `downgrade` の `drop_index` は `if_exists=True`**。同じリビジョンを「index 追加前」に適用済みの DB があると、後から index 行を足したリビジョンの downgrade がその DB で失敗する（`d4e5f6a7b8c9` が既に同じ対策をしている）。レビュー中に index を足したら、ローカルの test / development 両 DB を手で作り直す（`DROP TABLE ... CASCADE` ＋ `alembic_version` を親リビジョンに戻す ＋ `alembic upgrade head`）。

7. **検索・カーソルの実装は既存の `list_my_recipes` から共通ヘルパーに切り出して両方から呼ぶ**。`GET /recipes?feed=all` の中身は `GET /users/me/recipes` とほぼ同じ（LIKE エスケープ・`(created_at, id)` 複合カーソル・`limit+1` で `has_more`）。`apply_search_terms` / `resolve_authors`（N+1 回避の一括 author 取得）に分離した。フィード（`(created_at, id)`）と履歴（`(viewed_at, recipe_id)`）でカーソルのキーが違うので、エンコード関数はモジュールを分けて取り違えを防ぐ。

## 2026-09-09 画像 UI（Issue #40）で frontend-ts のピッカー・押下イベントを扱うとき

**きっかけ**: Issue #40（画像ピッカー・アップロード UI）。ユーザーによるブラウザ動作確認で立て続けに 3 件の不具合が出て、その原因追及で react-native-web の押下イベントの仕組みまで踏み込んだ。

### 検証のしかたの反省（最重要）

1. **【最重要】合成イベント（`dispatchEvent`）での検証を「実挙動の確認」と呼ばない**。単位候補が選べない不具合を調べる際、`new PointerEvent("pointerdown")` と `new MouseEvent("mousedown")` を自分で両方投げて「1 回の押下で `onPressIn` が 2 回発火する」と結論し、**実在しない不具合に合わせて設計を変えてしまった**（インライン一覧 → モーダル）。実際にはブラウザの本物のクリックで計測すると発火は **1 回**。react-native-web の responder は `mousedown` / `touchstart` しか購読せず `pointerdown` は無視するが、合成した `PointerEvent` は `MouseEvent` を継承しているため内部判定を通ってしまい、二重に処理されていた。**押下・フォーカスがからむ挙動は、必ず CDP 等で本物の入力イベントを送って確認する**。ハンドラの発火回数を数えるカウンタを一時的に仕込むのが確実。
2. **テストが緑でも実機で壊れる領域がある**。単位候補を押すテストは既に存在し通っていたが、`fireEvent.press` は**フォーカス移動を再現しない**ため、実ブラウザだけで起きる不具合（下記 #3）を検出できなかった。フォーカス・blur がからむ UI は、テストに**実際のイベント順序（触れる → blur → 離す）を明示的に書く**。

### react-native-web の押下イベント（実測で確認）

3. **`blur` は進行中の押下を打ち切る**。`ResponderSystem.js` は `documentEventsCapturePhase = ['blur', 'scroll']` を capture phase で購読しており、入力欄からフォーカスが外れると `onPress`（押し切り）が届かない。**入力欄の直下に出す候補リストは、`onPress` では選べない**（押すと先に blur が走ってリストが消える）。`onPressIn`（`mousedown` の時点）を使う。
4. **`onPress` を渡さないと `onPressIn` が配送されないことがある**。押し始めの通知は既定で 50ms 遅延される（`DEFAULT_PRESS_DELAY_MS`）。素早いクリックはその前に指が離れるため「遅延中に離された」経路に入るが、そこで `onPressIn` を配送する処理は `PressResponder.js` の `_performTransitionSideEffects` で **`onPress != null` のときしか走らない**。実測でも `onPress` を外すと発火回数が 0 になった。`onPressIn` を頼る場合は**空でも `onPress` を置く**。`delayPressIn={0}` でも解決するが、これは RNW 固有で React Native の型（`unstable_pressDelay`）と名前が食い違い `tsc` が通らない。
5. **「反転する操作」と「何度実行しても同じ操作」を区別して置き場所を決める**。値を入れる・開くは冪等なのでイベントが重複しても壊れないが、開閉のトグルは 1 回だけ確実に発火するハンドラに置く必要がある。

### UI 設計で踏んだこと

6. **「選ぶ」と「送る」を 1 つの状態にまとめない**。ピッカーを開いた時点で `uploading` にしていたため、利用者が写真を探している数十秒のあいだずっと「アップロード中…」と表示され、ボタンも押せなくなっていた。通信していない時間を「送信中」と呼ばない。**選択画面から戻ってこない環境もある**（ブラウザや自動化ツールの都合で `change` も `cancel` も来ない）ので、選択中もボタンを押せるままにして押し直せる逃げ道を残す。押し直しでは `requestId` の世代管理で古い結果を捨てる。
7. **サーバーが返した表示用 URL を捨てない**。`POST /images` は `key` と一緒にプレビュー用の `url` を返す設計にしていた（`ImageUploadResponse` に明記）のに、フロントで `key` だけ受け取って `url` を捨てていたため、「画像を選んだのにサムネイル欄に文字しか出ない」状態になった。**自分で設計したレスポンスでも、使う側で改めて定義を読む**。
8. **画像の表示枠は高さ固定ではなく `aspectRatio` で決める**。スマホの標準カメラは各社そろって **4:3・約 4000x3000（12MP）・JPEG 2〜5MB**。高さ固定にすると幅の広い画面ほど枠が横長になり、デスクトップ幅では比率が約 10:1 になって写真が帯状に切れる。**縮小の上限（`IMAGE_MAX_DIMENSION`）はクライアントとサーバーで同じ値にそろえる**（ずれると二重に縮小されて無駄に劣化する）。#40 では 4:3 ＋ 長辺 2048px に統一した。
9. **クライアント側の縮小は「画質」ではなく「アップロードを成功させるため」**。サーバーの受け入れ上限を超えた画像は縮小される前に 400 で弾かれ、利用者には「なぜか画像だけ登録できない」としか見えない。サーバー側の縮小・上限は悪意ある送信への防御として別途残す（多層防御で役割が違う）。

### テスト（React Native Testing Library v14）

10. **`render` / `fireEvent` は非同期なので必ず `await` する**。`screen.getByTestId` を使うと「`render` function has not been called」で全件落ちる。既存テストの書き方を先に読む。
11. **`fireEvent.press` の Promise は「イベントが処理された」時点で解決するだけ**で、`onPress` ハンドラ内の非同期処理の完了までは待たない。解決しない Promise を観測したいときは press を `await` せず投げっぱなしにし、`act` の中で解決させる（`await` すると RNW 内部の act が先に終了し、その後の state 更新が「act の外」と判定されて警告になる）。
12. **`expo-image` は `source` を配列に正規化する**。`expect(el.props.source).toEqual({ uri })` は落ちる。`[{ uri }]` で比べる。

---

## 2026-09-08 画像アップロード（Issue #39）で backend のストレージ・GC・削除キューを書くとき

**きっかけ**: Issue #39（`POST /images` ＋ レシピのサムネ / 手順画像 ＋ 一時アップロード GC ＋ ストレージ削除キュー）。

1. **「先に DB 行、あとでオブジェクト」の順序を崩さない**。`POST /images` は ①`pending` 行を INSERT して commit（キー確定）→ ②Tx 外で S3 に PUT → ③行をロックして `stored` に更新、の 3 段。逆順（先に PUT）にすると「オブジェクトはあるが DB に記録が無い」＝後から掃除できない孤児ができる。②で失敗しても行が `pending` で残るので GC が回収できる。**②を Tx の外に出す**のも重要で、外部 I/O を待つ間 DB のロックを握らない（processing-model.md §2・§9）。
2. **`Content-Type` と拡張子は信用しない。実データで形式を判定する**。クライアントは自由に詐称できる。Pillow に実際に開かせて JPEG/PNG/WebP だけ通す。テキストを `.jpg` にリネームしたものは `UnidentifiedImageError`、途中で切れた画像は `OSError` になるので**両方を捕まえて 400 にする**（片方だけだと 500 になる）。
3. **再エンコードは EXIF 除去も兼ねる**。スマホの写真には GPS 位置情報が入っていることがあり、公開バケットにそのまま置くとプライバシー事故になる。Pillow で `save` するとき EXIF を渡さなければ落ちる。あわせて `ImageOps.exif_transpose()` で**回転をピクセルに反映**しないと、写真が横倒しで表示される。
4. **サイズ上限は「読み切る前に」当てる**。`read()` で全部読んでから長さを測ると、巨大ファイルでメモリを食える。`read(limit + 1)` にして超過を検出する。境界値 {5MB, 5MB+1} をテストする。
5. **削除キューに積んだら管理行も消す**。当初は `pending_storage_deletions` に INSERT するだけにしていたら、レシピを消すたびに `uploads` の `consumed` 行が残り続ける緩やかなリークになった。管理行は「ストレージに存在していて追跡が必要なオブジェクト」を表すので、キューへ移した時点で役目を終える。
6. **1 キー = 1 参照を崩さない**。同じキーをサムネと手順の両方に指定できてしまうと、片方を消したときに**もう片方がまだ使っている画像**を削除キューに積む。保存前に body 内の重複を検出して 400 にする。
7. **PUT の「維持」は再検証しない**。このレシピに既に紐付いているキーは `consumed` 済みなので、他のキーと同じ検証（`stored` であること）に通すと 400 になってしまう。「今の参照集合」と「新しい参照集合」の差分を取り、**新規のものだけ消費し、外れたものだけキューに積む**。
8. **`Literal[...]` を SQLModel のカラム型にすると落ちる**。`status: Literal["pending", ...]` は `issubclass() arg 1 must be a class` で `alembic upgrade` が失敗する。`Field(..., sa_type=sa.String)` で SQL 型を明示すれば、Python 側は Literal で 3 値に絞りつつ DB は VARCHAR ＋ CHECK 制約で守れる。
9. **MinIO のバケットは作っただけでは非公開**。`create_bucket` しただけだと公開 URL が 403 になる。`put_bucket_policy` で `uploads/*` に匿名 GET を許可する必要がある（**バケット全体ではなく接頭辞で絞る**）。この処理は冪等なので `ensure_bucket()` にまとめ、ローカル起動時とテストの conftest から呼ぶ。
10. **`.env.test` の S3 資格情報は、起動している MinIO のルート資格情報と一致していないといけない**。ずれていると `PutObject` が `InvalidAccessKeyId` で落ちる。`.env.test` は `.gitignore` 対象でクローンごとに手で埋めるファイルなので、`.env.test.example` に「MinIO の `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` と一致させること」を明記しておく。CI も `.env.test` の生成と MinIO の起動で**同じ値**を使う。
11. **アプリ起動時の初期化は「失敗しても起動を止めない」**。バケット作成（`ensure_bucket()`）を lifespan で呼ぶと、まっさらな compose 環境の初回 `POST /images` が `NoSuchBucket` にならずに済む。ただし**本番の実 S3 ではバケットはインフラ側で事前作成され、アプリの資格情報に `CreateBucket` / `PutBucketPolicy` 権限が無い**のが普通なので、ここで例外を投げると本番だけ起動できなくなる。`try/except` で warning ログに留める。
12. **複数行を `FOR UPDATE` でロックするときは、取得順を固定する**。キーをリクエストが来た順にロックすると、`[A, B]` と `[B, A]` の 2 リクエストが相互待ちになり **PostgreSQL のデッドロック（500）**になる。本来は片方が「使用済み」で 400 になるべき場面。`sorted()` してからロックすれば、待たされた側は先行リクエストの結果を見て正しく 400 を返せる。**ソートするのはロック順だけで、検証とエラー表示は入力順を保つ**（利用者に見えるメッセージを変えない）。
13. **「読んでから書く」を守るのは、子行ではなく親行のロック**。同一レシピへの `PUT` が並ぶと、両方が同じ「現在の画像キー集合」を読んでから更新するため、負けた側のキーが `consumed` のまま無参照で残る。GC は `consumed` を意図的に回収しないので**ストレージに永久にゴミが残る**。子行（手順）は PUT の途中で作り直されるためロック対象にできない。**常に存在する親の 1 行**を待ち合わせ場所にする（`session.refresh(recipe, with_for_update=True)`）。
14. **1 件ごとに commit するジョブでは、ORM インスタンスを次の周回へ持ち越さない**。`with_for_update(skip_locked=True)` でバッチを取っても、**1 件目の commit でトランザクションが終わり残り全行のロックも解放される**（＝ロックは実質効いていない）。さらに commit 後はインスタンスが expire するので、他ワーカーが先に消した行の属性を読むと `ObjectDeletedError` でジョブごと落ちる。**`(id, key)` を素の値で控え、`delete()` / `update()` 文で処理する**。0 件更新が自然に no-op になり、重複を冪等に消化できる。
15. **バイト数の上限だけでは decompression bomb を防げない**。ベタ塗りの巨大 PNG は数百バイトまで圧縮されるので 5MiB 制限を素通りし、展開時に大量のメモリを確保する。`Image.open` はヘッダーしか読まないので、**`load()` の前に `opened.size` から画素数を検査**する。加えて Pillow 自身が投げる `DecompressionBombError` も 400 に変換する（捕まえないと 500）。
16. **`warnings.catch_warnings()` を Web アプリのリクエスト処理で使わない**。プロセス共有の警告フィルタを一時的に書き換える仕組みで、**スレッドローカルではない**（Python 3.14 でコンテキスト対応が入ったが、既定で有効なのは free-threaded ビルドのみ）。FastAPI は同期 `def` エンドポイントをスレッドプールで並行実行するため、別リクエストの警告設定を巻き込んで壊しうる。警告を例外化したくなったら、**自前の事前チェックで代替できないか**を先に考える。
17. **`pydantic-settings` は空文字を数値に変換できない**。`.env.production.example` に `IMAGE_MAX_BYTES=` のような空代入を残すと、テンプレートをコピーした本番が**起動時バリデーションエラー**になる（クラスの既定値は適用されない）。省略可能な設定は**行ごとコメントアウト**して書く。
18. **`openapi.json` を変えたら `expoApp/src/api/schema.ts` も再生成する**。`contract` ワークフローが `npm run gen:api` 後に `git diff --exit-code` で差分を見るので、忘れると CI が確実に落ちる。backend だけの Issue でも、API 定義に触ったら再生成が要る。
19. **コンテナのヘルスチェックは、そのイメージに入っているコマンドで書く**。`minio/minio` に `mc` は**入っていない**（`mc` は別イメージ）。compose 側は `curl -fsS http://localhost:9000/minio/health/live` を使っていたのに CI だけ `mc ready local` を書いてしまい、コンテナが永久に healthy にならず CI が lint すら実行せずに落ちる状態になった。**同じミドルウェアの設定は compose と CI で見比べてから書く**。
20. **「空文字は未指定」の正規化はスキーマ 1 か所に寄せる**。`thumbnailKey: ""` を送ると、`if thumbnail_key:` の truthy 判定で**検証だけすり抜けて DB には空文字が保存される**（非 NULL なのに URL は `null`、対応する `Upload` も無い、表示も削除もできない行になる）。Pydantic の `field_validator(..., mode="before")` で `None` に正規化すれば、POST と PUT の両経路が自動的に守られる。**サービス層で truthy 判定を書くたびに空文字の穴が増える**ので、入り口で潰す。
21. **保存前に捨てられる入力に紐付いたリソースを消費しない**。空白だけの手順は `_clean_steps` が捨てるのに、画像キーの収集は生の `body.steps` を見ていたため、**保存されない手順に付いた画像が `consumed` になって GC 対象外の孤児**になった。「正規化した後の配列」を単一の情報源にして、そこから派生させる。
22. **`codex exec` をバックグラウンドで実行すると、指示が渡らず空振りすることがある**。stdin が null に繋がれるため、Codex がプロンプトを標準入力から読もうとして即 EOF で終了する。出力は `Reading additional input from stdin...` の 1 行（39 バイト）だけで**終了コードは 0**なので、成功したように見える。「Codex が修正した」と報告しかけた。**出力サイズが極端に小さいときは必ず `git diff` で実際の変更を確認する**。フォアグラウンド実行（`< /dev/null` を明示）なら正常に動く。
23. **【重要】Git Bash の `pkill -f` は Windows のネイティブプロセスを殺せないことがある**。`pkill -f "uvicorn app.main:app"` は成功したように見えて実際には残り、**古いコードのサーバーが動き続けた**。結果「コードを直したのに直らない」に数十分溶かした（削除キューへの INSERT は動くのに管理行の DELETE だけ効かない、という一見不可解な症状になった）。**確実に落とすなら PowerShell の `Get-NetTCPConnection -LocalPort <port> | Stop-Process`**。Android E2E で「APK 内のバンドルが古いのでは」を疑ったのと同じ種類の罠で、**「直したはずが反映されていない」を最初に疑う**チェックリストに入れる。

---

## 2026-09-07 CI のバージョン更新をするとき

**きっかけ**: Issue #55（CI の GitHub Actions・JDK・Android API レベルの最新化）。Android E2E 不具合調査のためローカルにエミュレータ環境を作る過程で、CI が広範に陳腐化していることが判明した。

1. **RN プロジェクトの「使える JDK の上限」は AGP が決める。JDK 単独では上げられない**。RN 0.86 が同梱する `@react-native/gradle-plugin` の `gradle/libs.versions.toml` に AGP・Kotlin・（wrapper に）Gradle のバージョンが固定されている。RN 0.86 は **AGP 8.12.0 / Kotlin 2.1.20 / Gradle 9.3.1**。AGP 8.12 の対応 JDK は「最小・既定ともに 17」で、**JDK 24 / 25 は記載なし**（AGP 8.13 でも最小 17 のまま）。Gradle 側は 9.1+ で JDK 25 対応済みだが、AGP 内包の R8 / D8 / lint / core library desugaring が認証外 JDK で壊れる。**JDK を上げたいときは Expo SDK（＝ RN ＝ AGP）のメジャー更新を待つ**。現実的な上限は 21（LTS・現行 Android Studio 同梱 JBR）。
2. **`expo prebuild` が生成する `android/` は `.gitignore` 対象なので、ビルド設定（Gradle wrapper・AGP・compileSdk・`sourceCompatibility`）はリポジトリに無い**。バージョンの事実は `expoApp/node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml` と `react-native/package.json` の `engines`、Expo の prebuild テンプレートから確認する。「リポジトリを grep しても出てこない = 最新」ではない。
3. **GitHub Actions の公式アクションはメジャーが速い**。2026-09 時点で `actions/checkout@v7` / `setup-node@v7` / `setup-python@v7` / `setup-java@v6` / `cache@v6` / `upload-artifact@v7` / `gradle/actions/setup-gradle@v6`。プロジェクトは v4〜v5 で 1〜3 メジャー遅れていた。各メジャーの実体は **ESM 化 ＋ ランナー Node 24 化 ＋ 細かな enhancement** が大半で、我々の使い方（`node-version` / `cache` / `python-version-file` / `distribution: temurin` / `cache-read-only`）に破壊的変更は無かった。`upload-artifact` は v4.4 で隠しファイルがデフォルト除外（`include-hidden-files` で戻せる）だが、対象パスにドット始まりが無ければ影響なし。まとめて上げてよいが、**コミット前に全アクションのリリースノートを一読**する。
4. **`reactivecircus/android-emulator-runner` の `target` 既定は `default`（AOSP）で `google_apis` ではない**。`target` 未指定なら Play Services 無しの軽い AOSP イメージが使われる（Appium/UiAutomator2 での APK 操作にはこれで十分）。ローカルで `avdmanager` で AVD を作るときに `google_apis` を選ぶと CI と構成がずれるので、**CI に合わせるならローカルも `system-images;android-35;default;x86_64`** にする。AVD の cache key（`avd-35-x86_64` など）には必ず api-level を含め、レベルを上げたら key も変える（古い cache を引くと別レベルのイメージが復元される）。
5. **AGP バージョンより新しい JDK は「テストが存在しない」**。AGP 8.12 は 2025-07、JDK 25 は 2025-09。リリース時系列で後発の JDK は、そのツールでの検証結果が物理的に存在しない。「動くかもしれない」で本番 CI に入れない。

## 2026-09-07 レシピ画面（Issue #38）で frontend-ts のフォーム・一覧・ナビを書くとき

**きっかけ**: Issue #38（レシピ作成/編集・詳細・自分の一覧）の Codex レビュー（`--uncommitted` / `--base main` を複数巡）と、Chrome DevTools でブラウザから実バックエンドに繋いだ通し確認。

### レビュー運用の反省（重要）

1. **`codex review` の「重大なバグは 5 回上限を適用しない」例外を広げすぎない**。#38 では「編集保存で既存の手順画像が消える」指摘が 1・3・5 巡目に繰り返し出て、これをデータ破損の例外扱いで巡を続けた。しかし当時は `POST /images` が無く**画像を持つレシピが作れない**＝実害ゼロだった。さらに 5 巡目の対応（`RecipeResponse` に画像キーを追加）が 6 巡目の新しい指摘（キーが匿名ユーザーに漏れる）を生み、後追い修正が連鎖した。**「これが公開されたら第三者が今すぐ悪用できるか」「今この瞬間にデータが壊れるか」で判定し、"将来 X が入ったら壊れる" は受け皿だけ用意して todo 化 → ユーザーに一覧提示**して打ち切る。

### 実装で踏んだこと

2. **Expo Router の web スタックは遷移元の画面を DOM に残す（重ねて描画する）**。E2E（Playwright）で `getByText("タイトル")` がヒットしない / strict mode violation になるのは、旧画面の同じテキストが hidden で残っているため。**画面固有の要素は testID を振り、`.last()`（最前面）で取る**。`getByText().first()` は最下層の hidden 要素を掴む。
3. **`EXPO_PUBLIC_*` の値変更は Metro のキャッシュを確実にはバストしない**（既知の Expo の挙動）。`.env.development` を直しても `expo export` が古い値をインライン展開したままになる。API の向き先がおかしい（接続できない・ポートが違う）ときは **`expo export --clear` / `expo start -c`** でキャッシュを消す。
4. **web ビルドを E2E 用に静的配信するときは CORS 許可済みのポートを使う**。backend の `CORS_ALLOW_ORIGINS` は `localhost:8081` 等に限定。`npx serve -l 8082` のように任意ポートで配信すると signup 等が CORS で失敗し「通信エラー」になる（画面上は 409 と区別つかない）。
5. **backend の `NUMERIC(p, s)` は `"300.000"` のような文字列でシリアライズされる**。表示は整形関数（`formatQuantity`）で吸収できるが、**編集フォームの入力欄にそのまま出すと `300.000` と見える**。`fromRecipeResponse` で `Number(x).toString()` 相当の正規化をかける。テストのフィクスチャを `"3"` でなく `"3.000"` にしておかないと回帰で気づけない。
6. **内部のストレージ識別子（画像のオブジェクトキー等）はレスポンスに無条件で足さない**。編集の PUT で既存画像を維持するために `thumbnailKey` / `steps[].imageKey` を `RecipeResponse` に追加したが、公開レシピを匿名で見た第三者にも出てしまう。`serialize_recipe(..., include_image_keys=bool)` を足し、**投稿者本人向けのレスポンス（作成・更新・本人の GET）でのみ True**。
7. **モーダル / 詳細をディープリンクで直接開くと `router.back()` の戻り先が無い**。保存成功・削除成功・「×」で `router.back()` すると no-op で画面から出られなくなる。`router.canGoBack() ? router.back() : router.replace(<安定した行き先>)` にする（編集 = そのレシピ詳細、作成・削除 = ホーム）。
8. **`react-hooks` の新しい厳格ルール（`refs` / `set-state-in-effect`）**: 「取得が確定した最初の値を latch する」ために描画中に ref を書く / `useEffect` 内で `setState` するパターンはどちらも lint エラーになる。#38 では「初回マウント時に `useReducer` で 1 回だけ初期化」の既存挙動に留め、キャッシュ更新への追随は todo 化した。
9. **フォームの状態ロジックは `useReducer` の純粋な reducer ＋ 変換ヘルパー（`buildSubmission` / `isDirty` / `fromRecipeResponse`）に切り出す**。行追加・削除・並べ替え・グループ間移動・送信 body への正規化・dirty 判定を React 抜きで単体テストでき、WB テスト要件（分岐網羅）を満たしやすい。サーバー 400 の `details.errors[].loc`（配列インデックス）を行の localId へ翻訳するには、`buildSubmission` が「送信した i 番目 = どの localId か」の対応表も一緒に返す。
10. **並べ替え UI は上下ボタン方式で MVP を通す**（todo #21 で確定）。ドラッグ&ドロップは `react-native-draggable-flatlist` 等の新規依存 ＋ `react-native-reanimated` 運用（babel plugin・jest 設定）が要り、E2E も不安定になる。`screens/recipe-editor.md` §7 が「デスクトップは上下ボタンも用意」と既に書いており、両プラットフォーム共通で使える。

---

## 2026-09-06 レシピ CRUD（Issue #37）で backend の書き込み API・検索を書くとき

**きっかけ**: Issue #37（レシピ CRUD ＋ 単位 backend）の Codex レビュー（`--uncommitted`、3 巡・指摘ゼロで収束）。「request バリデーションは通るのに永続化 / 検索の段で壊れる」型の指摘が続いたため、書き込み API を作るときのチェックリストとして残す。

1. **`min_length=1` は「保存前に `.strip()` する項目」には効かない**。`title` や材料 `name` を `Field(min_length=1)` で受けても、スペースだけの入力（`"   "` / 全角 `"　"`）は生の長さが 1 以上なので通過し、その後 `.strip()` して空文字が保存される（ドキュメントの「1 文字以上」に違反）。**保存前に正規化する項目は、正規化後の値を `field_validator` で検証する**（`app/schemas/recipe.py` の `_reject_blank`）。認証の `_reject_blank_security_answer` と同じパターンで、`.strip()` するフィールドが増えるたびに必要。
2. **検索語を `ILIKE` パターンに素で埋め込むと `%` `_` `\` が SQL ワイルドカードとして効く**。`q=%` が全件マッチするなど「部分一致」の意味が壊れる。検索語側で `\` → `\\`、`%` → `\%`、`_` → `\_` にエスケープし、SQLAlchemy の `.ilike(pattern, escape="\\")` を必ず付ける（`app/services/recipe.py` の `list_my_recipes`）。Phase 4 のフィード全体検索 `GET /recipes` でも同じ。
3. **Pydantic の `Decimal` 型は DB の `NUMERIC(p, s)` の桁数・精度を勝手には守らない**。`quantity: Decimal = Field(gt=0)` だけだと、整数部 8 桁や過剰な小数を受け付けてしまい、`commit()` の瞬間に DB エラー → 500（バリデーションエラー 400 にならない）。DB カラムが `NUMERIC(10, 3)` なら、スキーマ側も `Field(max_digits=10, decimal_places=3)` でそろえる。
4. **`Depends` で `HTTPBearer` を使う「認証任意」エンドポイントは、それでも openapi.json に `security` を必須として出力する**。`GET /recipes/{id}` は公開レシピを匿名で見られる契約なのに、生成されたクライアント型 / API ツールには「認証必須」と伝わる。ルートデコレータに `openapi_extra={"security": [{}, {"HTTPBearer": []}]}` を付け、`{}`（＝認証なし）を選択肢に加える。認証必須の 422→400 置き換え（lessons 2026-09-05 認証 #10）と同じく、「例外ハンドラ / 依存性でデフォルト挙動を変えたら openapi 生成も直す」の一例。
5. **ユーザー入力を decode する経路は、想定外の例外型まで 400 に落とす**。カーソルページングの base64 デコードで `ValueError` / `binascii.Error` は捕捉していたが、非 ASCII 文字を含むカーソルは `cursor.encode("ascii")` が `UnicodeError` を投げ、捕捉漏れで 500 になった。`str` を受けて内部で decode / parse する箇所は、投げうる例外を洗い出して `validation_error` に変換する。
6. **材料と親グループの `recipe_id` 一致は複合 FK で担保する**（lessons 2026-09-01 材料リスト拡張 #1 の実装確認）。`ingredient_groups` に `UNIQUE(id, recipe_id)`、`ingredients` に `ForeignKeyConstraint(["group_id", "recipe_id"], ["ingredient_groups.id", "ingredient_groups.recipe_id"])`。SQLModel では複合制約は `__table_args__` に `sa.ForeignKeyConstraint` / `sa.UniqueConstraint` / `sa.CheckConstraint` を並べる（`Field(foreign_key=...)` では書けない）。手書きマイグレーションと 2 か所に書くことになるので、モデルとマイグレーションで制約名をそろえる。
7. **単位マスターの自動追加は `pg_insert(...).on_conflict_do_nothing(index_elements=["normalized"])`**。正規化キー（`trim + NFKC + casefold`）の UNIQUE で重複排除。SQLModel の `session.exec()` は SELECT 用なので、INSERT 文は `session.execute()` を使う（`session.exec(delete(...))` は可）。

---

## 2026-09-05 認証（Issue #35）でトランザクション・同時実行制御を書くとき

**きっかけ**: Issue #35（backend 認証）の Codex レビュー（`--uncommitted`、10 巡以上・指摘ゼロまで）と、Chrome DevTools でブラウザから実際に signup→login→refresh→password-reset の一連を叩いた動作確認。同時実行・タイミング絡みの指摘が連続して出たため、パターンとして残す。

1. **【最重要】FastAPI の `Depends(yield)` は、レスポンス送信後に後始末コードを実行する**。`get_session`（`yield session; session.commit()`）のように「関数の最後に自動 commit する」依存性を作ると、`session.commit()` は**クライアントに成功レスポンスを送り終えた後**に実行される（ストリーミングレスポンスでセッションを生かしておくための FastAPI の仕様）。このため「パスワードリセット成功（204）の直後に、同じ古いアクセストークンで別のリクエストを送ると、ごく短い時間だけ 401 にならず通ってしまう」「サインアップ成功（201）の直後にログインすると、ごく短い時間だけ 401 になる」という**再現性のある競合状態**が起きた。これは単体テスト（DB との通信が1リクエスト内で完結するTestClient）では気づけず、Chrome DevTools で `fetch()` を連続実行する実際のブラウザ確認で初めて発覚した。**直し方**: `get_session` の自動 commit に頼らず、書き込みを終えたルーター関数側で `return` する直前に必ず明示的に `session.commit()` を呼ぶ（`get_session` 側の自動 commit は書き忘れ時の保険として残す）。**教訓**: 「1 リクエスト = 1 トランザクション」を謳うだけでなく、DB 書き込みの完了とクライアントへの応答送信の順序を保証する実装になっているかを、単体テストだけでなく実際のクライアント視点（連続リクエスト）で確認する。
2. **行ロックを取る順序をエンドポイント間で統一する**。`refresh` は「リフレッシュトークン行」と「ユーザー行」の両方をロックするが、`password_reset_confirm` も同じユーザー行をロックする。ロックする順序（今回は「ユーザー行 → トークン行」で統一）がエンドポイントごとにバラバラだと、A が先にトークン行→ユーザー行の順で、B がユーザー行→トークン行の順でロックしようとした場合に相互待ちでデッドロックしうる。複数エンドポイントが同じ行を触るときは、ロック順序を最初に決めて全箇所で揃える。
3. **`get_session` の「例外時 rollback」パターンは、エラーを返す直前の `session.add()` も一緒に消す**。「失敗を記録してから 400/401/429 を返す」実装（パスワードリセットの試行回数カウント、リフレッシュトークンの reuse 検知でのチェーン失効など）では、`raise` する前に明示的に `session.commit()` しないと、`get_session` 側の `except: session.rollback(); raise` でその記録ごと消える。「エラーと一緒に副作用を残したい」ときは exception を投げる前に必ず commit する。
4. **同じセッション内で同じ行を 2 回 select しても、2 回目は DB の最新値を読まない**。SQLAlchemy の identity map は、既に読み込み済みの行（同じ PK）を再度 `select`（`with_for_update()` 付きでも）すると、キャッシュ済みの Python オブジェクトをそのまま返し、属性を上書きしない。ロック取得後に最新状態を読み直したいときは `session.refresh(obj, with_for_update=True)` を使う。
5. **単一項目（メールアドレス等）だけのレート制限は、その項目を変えられると回避される**。パスワードリセットの試行回数ロックをメールアドレス単位だけにすると、攻撃者が候補メールを 1 回ずつ変えるだけで無制限にアカウント存在確認ができてしまう。IP アドレス等、別次元でも同時にカウントする（このプロジェクトでは `password_reset_attempts` に `ip_address` 列を足し、email 単位・IP 単位の両方をチェック。ただしリバースプロキシ配下では `request.client.host` がプロキシ自身のアドレスになる既知の限界があり、信頼するプロキシ構成が決まるまでは対応を見送った）。
6. **↑ の IP ベース制限は結合テストの `TestClient` が全リクエストで同じダミー IP を使うため、テスト間で状態が混ざる**。`password_reset_attempts` のような「レート制限用に永続化する行」があるテーブルは、各テスト前に空にする必要がある。ただし、この後始末 fixture を `autouse=True` にしただけだと、DB 接続を必要としない単体テスト（`test_config.py` 等）まで DB に繋ぎに行ってしまい、「Docker 無しで `pytest -m 'not integration'` が通る」という前提を壊す。`request.node.get_closest_marker("integration")` で対象を絞り込み、結合テストのときだけ DB を触るようにする。
7. **Pydantic v2 で「保存前に正規化する」バリデータ（例: メールの trim + 小文字化）は `field_validator(..., mode="before")` にする**。デフォルトの `mode="after"` だと `EmailStr` 等の型バリデーションが正規化より先に走り、前後に空白が付いた入力が弾かれる。また `mode="before"` は正規化前の値の型が保証されないため、`isinstance(value, str)` を確認してから処理し、非文字列はそのまま後段のバリデーションに委ねる（`.strip()` が生の `AttributeError` を投げると `RequestValidationError` を素通りして 500 になる）。
8. **「複数の失敗理由を同じエラーにまとめて区別させない」設計では、Pydantic の `Field` 制約（`min_length` 等）をその項目にだけ付けてはいけない**。パスワードリセットの `confirm` は「メール不明・回答不一致・新パスワード不正」を同じ 400 にする契約だが、`new_password` に `Field(min_length=...)` を付けると、その場合だけ Pydantic 自身の `RequestValidationError`（別のエラー形式）で弾かれてしまい、外形から失敗理由が見分けられてしまう。この手の項目はスキーマでは緩く受け、エンドポイント側で他の失敗条件と同じ `if` 分岐にまとめてチェックする。
9. **ログイン等の「ユーザーが見つからない／パスワード不一致を区別しない」401 は、処理時間も揃える**。`user is None or not verify_password(...)` は Python の短絡評価により、ユーザーが存在しない場合は Argon2 の検証処理そのものをスキップする。レスポンスの中身は同じでも、存在しないメールの方が明らかに速く返るため、応答時間の差でアカウントの実在を推測されてしまう（タイミング攻撃）。ユーザーが見つからない場合も、固定のダミーハッシュに対して同じ Argon2 検証を必ず 1 回実行する。
10. **例外ハンドラでデフォルトの HTTP ステータス（422 等）を上書きしたら、`openapi.json` の生成も上書きする**。FastAPI は標準でバリデーションエラーを 422 として文書化するが、独自ハンドラで実際には 400 を返すようにしても、`app.openapi()` を差し替えないと契約（`openapi.json` → 生成されるフロントの型）と実際の挙動が食い違う。`app.openapi = カスタム関数` で `responses` の `422` を実際のステータスに書き換える。ただしこれは「バリデーションエラー」の 422→400 置き換えにしかならず、各エンドポイントが返しうる 401/404/409/429 等は自動では openapi.json に載らない。ルーターの `@router.post(..., responses={401: {"model": ErrorEnvelope}, ...})` のように、実際に返しうるステータスごとに明示する必要がある（api.md の「統一エラーレスポンス」を正としてエンドポイントごとに突き合わせる）。
11. **JWT の改ざん検知テストで、署名の末尾 1 文字だけを変える手法は稀に失敗する**。base64url の末尾の文字は「余りビット」に当たることがあり、変えても実際にデコードされるバイト列が変わらず、署名検証をすり抜けてしまう（テストが確率的に flaky になる）。tamper するなら署名部分の先頭寄りの文字を変えるなど、確実にデコード結果が変わる位置にする。

## 2026-09-05 ESLint を型情報ベースで厳格化するとき

**きっかけ**: Issue #34 の scaffold に、ユーザー要望で `no-floating-promises` / `no-explicit-any` / `react-hooks/exhaustive-deps` を追加。

1. **`no-floating-promises` は型情報が要る**。フラットコンフィグでは対象ファイルの `languageOptions.parserOptions.projectService: true` を設定しないと有効にならない（構文だけのルールと違い、`tsconfig.json` の型チェックに相乗りする）。
2. **`eslint-config-expo/flat` は `@typescript-eslint` と `react-hooks` プラグインを既に登録済み**。追加のルールを使うだけなら `plugins` を自前で再登録する必要はなく、`files` を絞った設定オブジェクトに `rules` だけ足せばよい（フラットコンフィグは対象ファイルにマッチする全設定オブジェクトの `plugins` をマージする）。
3. **`tsconfigRootDir: __dirname` を `.js` の設定ファイル自身に書くと `no-undef` で落ちる**。`eslint.config.js` は Node の CommonJS 実行だが、Expo のベース設定は `.js` ファイルに Node のフル環境（`__dirname` 等）まではグローバル登録していない。`projectService` は既定で `process.cwd()` 起点に tsconfig を探すため、通常は `tsconfigRootDir` を省略してよい。
4. **`react-native-reanimated` を実際に使い始めたら `babel.config.js` に `plugins: ["react-native-reanimated/plugin"]` の追加が必須**（配列の最後に置く）。`package.json` には依存として入っているが、現状の scaffold では `useSharedValue` 等の API をまだ使っていないため未設定。設定を忘れたままアニメーション実装に着手すると動かず詰まるので、着手時に思い出すこと。

## 2026-09-04 frontend の scaffold を作るとき

**きっかけ**: Issue #34（Expo scaffold ＋ CI）。React Native / Expo エコシステムの依存の食い違いを多数踏んだ。

1. **`create-expo-app --template default` はデモ盛りだくさん**。テーマ切替・アニメアイコン・タブデモ・`.claude/`・`AGENTS.md`・`LICENSE`・大量の画像。scaffold としては `src/app/{_layout,index}.tsx` だけ残して他は削る。
2. **`.npmrc` に `legacy-peer-deps=true` を置く**。RN/Expo の周辺パッケージは peer 依存の範囲が古いままのことが多く（例: `openapi-typescript` が `typescript@^5` を要求するが Expo は TS 6 を入れる）、これが無いと `npm install` が止まる。
3. **`@testing-library/react-native@14` は `test-renderer`（React 19 で `react-test-renderer` から分離した別パッケージ）を peer に要求する**。入れないと「Cannot find module 'test-renderer'」でテストが全滅。
4. **`jest` / `@react-native/jest-preset` は明示インストールが必要**、かつ jest-preset は **RN と同じバージョン**にそろえる（`@0.86.3`）。latest を入れると別の RN 向け設定と食い違って壊れる。
5. **MSW は jest-expo の react-native 実行環境で動かない**（msw の `exports` が `"react-native": null` を宣言）。`jest.setup` で `import "msw/node"` すると全テストが「require of ESM」で落ちる。Phase 0 は API クライアントを `jest.mock` で差し替える方式にし、MSW の本格導入（node 環境のテスト）は Phase 1 に回す。
6. **`eslint` は 9.x に固定**。`eslint-config-expo` の依存する `eslint-plugin-react` が ESLint 10 の API 変更（`context.getFilename` 廃止）で壊れる。
7. **`EXPO_PUBLIC_API_BASE_URL` は「ホストまで」**（`http://localhost:8000`）にし、`/api/v1` などのパスは `openapi.json` → `schema.ts` 側に含める。openapi-fetch の `baseUrl` ＋ 型付きパスの標準の使い方。
8. **`expo-env.d.ts` はコミットする**（テンプレは gitignore するが、CI の `tsc` を安定させるため `/// <reference types="expo/types" />` の 1 行版を置く）。
9. **prettier / eslint の ignore に `src-tauri/` と生成物を必ず入れる**。入れないと `src-tauri/target/` の数百ファイルを prettier がスキャンする。

## 2026-09-04 backend の scaffold を作るとき

**きっかけ**: Issue #33（FastAPI scaffold ＋ CI）。実装中に踏んだ落とし穴。

1. **PostgreSQL 18 はデータディレクトリのマウント位置が変わった**。`postgres:18` は `/var/lib/postgresql`（親）をマウントする構成が推奨で、旧来の `/var/lib/postgresql/data` にボリュームを当てると起動時にエラーで落ちる。
2. **DB が居ないと `create_engine` の接続がブロックしてテストがハングする**。`connect_args={"connect_timeout": 3}` を付けて短時間で失敗判定させる。ヘルスチェック（readiness）や「DB 未起動でも通る単体テスト」で効く。
3. **`APP_ENV=test` はコマンドに書かず conftest.py で強制する**。`pytest` とだけ打っても開発用 DB につながないため。`pyproject.toml` の `env=[...]` は `pytest-env` プラグインが要るので、依存を増やさず conftest の先頭で `os.environ["APP_ENV"]="test"` するのが軽い。
4. **`.env.test` が無い環境（新規クローン）向けのフォールバックは `os.environ.setdefault` で**。ただし `.env.test` が存在するときは触らない（`os.environ` は `.env` ファイルより優先されるため、setdefault でも `.env.test` を上書きしてしまう）。→ 「ファイルが無いときだけ setdefault」。
5. **mypy strict はテストにもフルで効く**。`[[tool.mypy.overrides]] module=["tests.*"]` で `disallow_untyped_defs=false` にし、テストは `-> None` の連打を不要にする。アプリ本体（`app/`）は strict のまま。
6. **契約テスト（openapi.json の diff）は生成の安定性が命**。`json.dump(spec, sort_keys=True, indent=2)` ＋ 末尾改行で、再生成しても diff が出ないようにする。
7. **GitHub Actions の `services:` はコンテナの `command` を上書きできない**。MinIO のように `server /data` の引数が要るイメージは service にしづらい。ストレージのテストが無い Phase 0 では postgres だけ service にして、MinIO は #39 で足す。
8. **バージョン固定は「実際に venv で入れて解決したもの」を `==` で書く**。推測で書かず、`pip install`（floor 指定）→ 動作確認 → 解決版を requirements に固定、の順。

## 2026-09-03 環境変数ファイル・ローカル実行手順を作るとき

**きっかけ**: Issue #32（`.env.*.example` ＋ ローカル実行手順）。#32 の Codex レビューで採用した指摘。

1. **Expo は `expoApp/` から `.env` を読む**（リポジトリルートではない）。フロントの `EXPO_PUBLIC_*` はルートの `.env.*.example` に入れず、`expoApp/.env.*.example` に分ける。
2. **`docker compose` は `.env.development` を自動で読まない**。`${...}` 展開用の値は `--env-file .env.development` で明示的に渡す（compose の既定は `.env` のみ）。サービスの `env_file:` は「コンテナ内のランタイム変数」で、`${...}` 展開とは別の役割。
3. **コンテナ内 ⇄ ホストのホスト名を区別する**。バックエンドをホストで動かすなら `localhost:5432` / `localhost:9000`、compose の `api` サービスとして動かすなら `postgres` / `minio`（サービス名）。`api` サービスの `environment:` で上書きする。
4. **クライアントが読む URL は `localhost` にできない**。`S3_PUBLIC_URL_BASE`（画像 URL）や `EXPO_PUBLIC_API_BASE_URL` は、Android エミュレータなら `10.0.2.2`、実機なら開発マシンの LAN IP。Web / デスクトップ / iOS シミュレータは `localhost` で可。
5. **README のコマンドは Windows と POSIX を分ける**。venv 有効化（`source .venv/bin/activate` vs `.\.venv\Scripts\Activate.ps1`）、環境変数の一時設定（`VAR=x cmd` vs `$env:VAR='x'; cmd`）は互換性がない。開発者は Windows。テストの `APP_ENV=test` はコマンドに書かず **pytest 設定側で強制**すると OS 差が出ない。
6. **接続文字列は「本物を埋め込んだ形」で `.example` に書かない**。`postgresql+psycopg://<user>:<password>@<host>:<port>/<db>` のテンプレート、または各要素を別変数に分ける。組み立て済みの実 URL は `.gitignore` 対象の `.env.<APP_ENV>` のみ。
7. **`docs/requirements/` 配下の相対リンクに `requirements/` を前置しない**（このミスは 3 回目）。`architecture.md` から兄弟ファイルへは `[environment.md](environment.md)`。
8. **同じ「標準フロー」を 2 つの正の文書に別々に書かない**。`environment.md` で「ホスト実行が標準」と書くなら `architecture.md` の該当記述も合わせる（片方だけ直すと矛盾する）。

## 2026-09-02 処理方式を横断で決めるとき

**きっかけ**: Issue #26（処理方式ドキュメント `processing-model.md` の新設）。トランザクション境界・同期 / 非同期 / バッチが non-functional.md と各 features に散らばっていた。

1. **1 リクエスト = 1 DB トランザクション原則**。外部サービスへの呼び出し（S3 / MinIO の PUT / DELETE・AI プロバイダ）はトランザクション外に出す（外部待ちでロック保持が延びると性能目標を壊す）。**ただし DB だけで完結する副作用（削除キューへの行 INSERT・単一行の通知）はトランザクション内に入れる** — コミットと運命を共にできるので取りこぼしが起きない（Codex #26 P1 指摘: 「削除キューがあるのに `BackgroundTasks` でエンキューするとプロセス断で消える」）。
2. **「行を先に作ってキーを確定し、そのあと外部にアップロード」**。オブジェクトだけ存在して DB 行が無い、という後始末できない状態を作らない。失敗した行は状態（`pending`）で判別し GC が回収する（Codex #26 P2 指摘）。
3. **`BackgroundTasks` は「失われても整合性を壊さないもの」限定**。プロセスが落ちると消えるため。壊れると困る整合は「同期でトランザクション内」か「定期バッチの多層防御」で守る。
4. **通知は単一行なら発火元と同一トランザクション、fan-out（N 行）なら非同期後処理**。相手の数でスケールするかどうかで切り分ける。
5. **MVP は従来方式（`BackgroundTasks` ＋ cron 起動の管理 CLI コマンド）で始める**。専用ジョブキュー（arq / Celery + Redis）は Redis と運用コストが増えるので、大量フォロワーの性能測定や再試行要件が出てから Phase 10 以降に判断。
6. **処理方式は features に散らさず、横断ドキュメント 1 か所を正にする**。各 features / non-functional.md / architecture.md / api.md / data-model.md からはそこへリンクする。
7. **各方式に「なぜそれを選んだか」を併記する**。「同期 / 非同期 / バッチ」に唯一の正解は無く、利用者数・許容遅延・障害時の挙動という前提次第で変わるため、後からレビューする人・将来の自分が判断根拠を追えるようにする。
8. **ユーザーが知らない技術を提案するときは初心者向けに説明する**（説明＋なぜ必要か＋使わないと何が困るか＋代替案）。要件定義書は学習を兼ねた資料でもある。

## 2026-09-02 AI 機能を要件に足すとき

**きっかけ**: PR #25（AI 誤字脱字チェック・Phase 11）。

1. **プロバイダを抽象化して環境で切り替える**: `AI_PROVIDER` = `local`(dev) / `anthropic`(prod) / `stub`(test)。バックエンドに Protocol（校正サービスの抽象）を置き、**API 契約（`POST /ai/proofread` の body/response）はプロバイダ非依存**に保つ。dev はローカル推論で API 課金ゼロ＋学習、prod はクラウド、CI はスタブでモデルも鍵も不要。
2. **AI は「任意機能」に徹する**: レシピの保存フローは AI 呼び出しの成否に依存させない。タイムアウト・レート制限・入力上限を**最初から要件に**書く（後付けにしない）。プロバイダ障害は 503（`AI_UNAVAILABLE`）、レート制限は 429。
3. **自動適用しない**: 修正案は必ずユーザーが項目ごとに「適用 / 無視」。AI が勝手にレシピ本文を書き換えない。
4. **API キーは `.env` のみ**: `ANTHROPIC_API_KEY` 等の実値を、コミット対象ファイル・コミットメッセージ・PR / Issue 本文のどこにも書かない。`.env.*.example` はプレースホルダ（`ANTHROPIC_API_KEY=`）。`docker-compose.yml` は `${...}` 参照。
5. **dev / prod で結果が変わることを明記**: 小型ローカルモデルとクラウドモデルは精度が違う。「提案」機能なので許容だが、要件に注記して驚かせない。
6. **モデルの具体は spike に回す**: プロバイダ構成（切替の仕組み）は今決める。具体モデル・実行方式（compose サービス vs in-process）・モデルバージョンは Phase 着手前の spike（todo）。
7. **非同期チェック結果の陳腐化ガードは「件数比較」では不十分**（プロトタイプ PR #25 の Codex 指摘）: 材料 / 手順を削除→追加すると件数が元に戻り、古い index に紐づく修正案を受け入れてしまう。**構造変更のたびに ++ する単調カウンタ（epoch トークン）**を送信時にキャプチャし、コールバックで一致を確認する。加えて**画面を離れたか**（ルート判定。破棄確認ダイアログ表示中も含む）も確認し、editor 以外なら結果を捨てる。
8. **spike 項目でも「確定した部分」と「未確定の部分」を分けて書く**（同 Codex 指摘）: 「対象フィールドの確定」と一括で todo に置くと、feature 側で確定済みの記述と矛盾する。「タイトル・説明・手順・材料名は確定。材料グループ名は未確定」のように粒度を分ける。

## 2026-09-01 サーバー保存の一覧機能を足すとき

**きっかけ**: PR #22（閲覧履歴 `recipe_views`）の Codex レビュー。

1. **サーバー保存のデータはログアウトで消さない**: 「端末間で同期される」= 同じアカウントで入り直せば残る。ログアウトで消してよいのは session / UI 状態だけ（トークン・検索フィルタ等）。消えるのはアカウント削除の CASCADE のとき。
2. **「記録するタイミング」を再描画から切り離す**: 「詳細を開いたら記録」を画面のレンダー関数に書くと、♡ トグルや感想投稿の再描画のたびに再記録される。記録は**遷移イベント**（ルーターの genuine navigation）で 1 回だけ。実 API では `GET /recipes/{id}` 成功後に `POST .../view` を非同期で 1 回。
3. **可視性フィルタはお気に入りと同じ**: `is_public = true OR author = me`。後から非公開化された他人のレシピは一覧から外すが、行（`recipe_views`）は残す。削除は `recipe_id` の CASCADE で行ごと消える。
4. **`GET` に副作用を持たせない**: 閲覧記録は専用の `POST .../view` にする。`GET /recipes/{id}` は匿名可なので、そこに書き込みを埋めない。

## 2026-09-01 ナビゲーション構成を変えるとき

**きっかけ**: PR #19（検索を独立 destination から外し、ホーム画面上部の常時固定検索窓に。ボトムナビ 5 → 4）。

1. **destination の数は複数ファイルに散らばる**: `screens/navigation.md`（本文 ＋ Mermaid の subgraph ノード ＋ プラットフォーム差分表 ＋ 認証ゲート）、`screens/components.md`、`screens/README.md`（画面一覧表・読み方）、`glossary.md`（ボトムナビ / ナビゲーションレール / destination）、`screens/transitions.md`（全体遷移図 ＋ フロー別図）、`features/*.md`（該当機能）、`roadmap.md`。「5 destination」「5 つ」で grep して全部直す。
2. **画面ファイルを消したら参照を張り替える**: `screens/search.md` を消したら、`recipe-detail.md` の入口リンク `[検索](search.md)` などが壊れる。`grep 'search\.md'` で拾う。features 側の `features/search.md`（機能仕様）は残す — 画面と機能を分けて考える。
3. **プロトタイプと画面仕様は同じ PR で揃える**: 画面仕様に「Esc でクリア」「再タップで最上部へスクロール」と書いたら、プロトタイプもその通りに動かす（Codex が細部の食い違いを 1 つずつ指摘してくる）。書いた仕様は自分で実装して検証する。
4. **プロトタイプがまだ未マージのブランチにしかない場合**: 画面仕様の変更はそのブランチ（PR #18）に積み、PR のベースを親ブランチにする。親がマージされれば自動で main に張り替わる。

## 2026-09-01 複数フロントエンドトラックを要件に足すときの注意

**きっかけ**: PR #14（カリキュラム指定の TypeScript/Expo フロントを、既存の Kotlin/Compose フロントと並行トラックとして追加）。

1. **API 契約を単一の正に保つ**: クライアントが増えても `openapi.json` ＋ 要件定義書が唯一の契約。各言語はそこから生成（Kotlin: OpenAPI Generator、TS: openapi-typescript）。CI で全生成物の差分チェック。API 仕様の本文（エンドポイント・データモデル制約）は 1 文字も変えない。
2. **画面仕様を framework 中立にする**: `screens/*.md` から特定フレームワークの部品名（Composable 等）を外し、挙動・レイアウト・状態・遷移で書く。Mermaid の図も「App ルート Composable」のような実装名を避ける。両トラックが同じ仕様に従えること。
3. **ゲートは 1 トラックだけ**: 必須トラック（frontend-ts）だけを自動連続実行の完了判定に含め、随時トラック（frontend-kotlin）は非ブロッキングと明記する（roadmap.md ＋ CLAUDE.md の「自動着手条件」両方）。
4. **`shared` は片側専用**: KMP の `shared` は Kotlin トラック専用。TS 側は `expoApp` 内に対の実装（表示整形・入力チェック・生成クライアント）を持つ、と glossary / architecture / tech-stack で一貫させる。
5. **プラットフォーム固有機能の吸収方式がトラックで違う**: Kotlin = `expect`/`actual`、TS = Expo モジュール ＋ Tauri プラグイン。non-functional.md のセキュアストレージ節など、両方式を併記する。

## 2026-09-01 バックエンド技術スタック変更の波及範囲

**きっかけ**: PR #11（バックエンドを Kotlin/Ktor → Python/FastAPI へ）。コア技術を差し替えるときのチェックリスト。

1. **技術名は `tech-stack.md` 以外にも散らばっている**: `architecture.md`（リポジトリ構成図・サービス表）、`roadmap.md`（Phase 0 の scaffold 内容）、`data-model.md`（マイグレーションツール名）、`non-functional.md`（ハッシュ方式・認証機構の呼び方）、`glossary.md`（用語）、`features/auth.md`・`features/unit.md`（ハッシュ・シード投入）、`screens/navigation.md`（実装レイヤー図）、root `CLAUDE.md`。差し替え時は全ドキュメントを `grep` で洗う。
2. **DB 制約の内容とツール名を分けて扱う**: ORM / マイグレーションツールが変わっても、複合 FK・カウント列トランザクション・CASCADE などの **DB レベルの制約仕様は不変**。ツール名だけ置換し、制約の記述は触らない。「DB を正とし、ORM で表現できない制約は手書きマイグレーションで補う」と明記しておく。
3. **コンパイル時型共有が使えなくなる場合の代替を先に決める**: BE/FE が別言語になったら `shared` モジュールでの DTO 共有は不可。OpenAPI 生成 + CI 差分チェックに置き換え、`shared` の役割定義も書き換える。
4. **フロントは変えていないことを検証項目にする**: バックエンドだけの変更なのに、レイヤー図やクライアント（Ktor Client）の記述を巻き込んで壊さないこと。

**この PR で Codex が指摘し採用したもの（4 巡・指摘ゼロまで）**:

- バージョンは「固定」と書いたら固定手段（`.python-version` / `requires-python` の上限 / Docker タグ）まで揃える。`>=3.14` だけでは将来の非互換版を拾う。
- ライブラリ選定が未確定なら表の「採用」欄でも「未確定」と書く。1 箇所で PyJWT と断定し別行で「PyJWT / Authlib から選定」と書くと実装が割れる。
- 言語をまたぐと `shared` での BE/FE ロジック共有は不可。「単位の表示整形は `shared` でフロント / バック共用」のような既存記述を「表示はクライアント側の関心」に改める。API は素の値を返す。
- 「OAuth2 パスワードフロー」と安易に書かない。既存の API 契約が JSON `{ email, password, rememberMe }` なら、標準 OAuth2 のフォーム形式と矛盾する。独自の Bearer 認証依存性 ＋ JSON エンドポイント、と明記する。
- `.env.example` 単一 → 環境別 3 ファイルに変えたら、参照している全ドキュメント（non-functional.md のセキュリティ節など）を揃える。

## 2026-08-31 要件定義書のCodexレビューで採用した指摘

**きっかけ**: PR #2（要件定義書）の Codex レビュー（17 巡・指摘ゼロまで）。次回以降、要件・API・データモデルを書くときのチェックリストとして使う。

1. **一覧 API のスコープを画面遷移と突き合わせる**: 「自分のもの / 他ユーザーのもの / 全体」のどれが必要か。`/users/me/...` を書いたら `/users/{id}/...` も要らないか確認する。
2. **画面フローと API の粒度を合わせる**: 画面が「A を送信 → 結果確認 → B を入力」と多段なら、API もその段数に合わせるか、画面を 1 回送信に変える。中間検証だけのエンドポイントを勝手に想定しない。
3. **非正規化カウント（`*_count`）は全経路で整合させる**: 通常の増減トランザクションだけでなく、**`ON DELETE CASCADE` で消える行**（アカウント削除など）も、同一トランザクション内でカウントを補正する。後追いの補正ジョブ任せにしない。
4. **`ON DELETE CASCADE` と「レコードは残してよい」は両立しない**: 「削除されても行は残る」と書いたら FK の削除ポリシーと矛盾しないか確認。非公開化（行は残る）と削除（CASCADE で消える）を分けて書く。
5. **ステートレス JWT の無効化には仕組みが要る**: アカウント削除・パスワードリセットで「以降 401」と書くなら、認証ミドルウェアでの存在チェック or `token_version` クレーム照合を必ず定義する。行を消すだけでは既発行トークンは失効しない。
6. **リフレッシュトークンのローテーション**: 「猶予中に同じ応答を返す」方式は盗用トークンのリプレイを許す。クライアント single-flight を第一の対策にし、消費済みトークンの再提示は例外なくチェーン失効。
7. **カーソルページングは一意なタイブレーカー必須**: 時刻のみのソートは重複 / 抜けを生む。`(created_at DESC, id DESC)` を標準にし、cursor に両方をエンコードする。
8. **画像などの一時アップロードは所有者・使用状態を持つ**: `imageKey` を紐付ける前に「本人所有 かつ（未使用 or 更新対象自身に既に紐付け済み）」を検証。全入れ替え更新では「残したいキーは再送」を明記。
9. **署名付き URL を採用しうるなら URL 列を永続化しない**: DB にはオブジェクトキーを持ち、URL はレスポンス生成時に作る。
10. **秘密の質問リセットは実在判別を避けられない**: 完全な存在秘匿はメールベース方式が要る。当面は既知の制約として明記し、`confirm` の失敗理由は区別しない同一 400。
11. **「実装時に確定」と断定を同居させない**: 「X はしない」と書いたら TODO からその項目を消す。両方残すと実装が割れる。
12. **非公開リソースへのアクセスは 404 で統一**（403 は ID の存在を漏らす）。

---

## 2026-08-31 画面設計のCodexレビューで採用した指摘

**きっかけ**: PR #7（画面設計を `screens/` へ分割）の Codex レビュー（4 巡・指摘ゼロまで）。ドキュメントを分割・再構成したときの整合チェック項目。

1. **分割元と分割先で「認証要否」を一致させる**: 機能ドキュメントが「詳細は匿名可」なのに画面ドキュメントで「全画面ログイン必須」と書くなら、どちらが正でどちらが将来余地かを明記する（API の余地とアプリの方針を分けて書く）。
2. **自分 / 他人で遷移先を分岐する**: 一覧の行タップ・投稿者名タップは「他人 → ユーザープロフィール、自分 → マイページ」を各画面の §5 でも明記する（§2 だけに書くと §5 を literal に実装される）。
3. **同じアクションの結果を 1 つに定める**: 「検索語が空のとき」の表示を、レイアウト節と状態節と機能ドキュメントで食い違わせない。
4. **一覧に出ないものの「タップ状態」を書かない**: サーバーが除外するもの（削除済み対象の通知など）は一覧に出ないので、その行の状態は不要。取得後の競合は「稀ケース」として §5 に 1 行で。

---

## 2026-09-01 材料リスト拡張のCodexレビューで採用した指摘

**きっかけ**: PR #9（材料グループ ＋ 他レシピ参照）の Codex レビュー（3 巡・指摘ゼロまで）。

1. **他テーブルを見る `CHECK` は書けない**: 「子行の値 = 親行の値」を保証したいなら **複合外部キー**（親に `UNIQUE(id, parent_key)`、子に `FK (parent_id, parent_key) → 親(id, parent_key)`）。PostgreSQL の `CHECK` は自分の行しか見れない。
2. **選択肢の範囲とピッカーの取得元を一致させる**: 「有効な選択肢は自分のものだけ」なら、ピッカーの検索も自分のもの限定エンドポイント（`GET /users/me/recipes?q=`）を使う。全体検索（`GET /recipes?q=`）を流用すると無効な候補が出て選ぶと 400 になる。
3. **アカウント削除の CASCADE と個別削除の SET NULL を混同しない**: 参照が「同一所有者間のみ」なら、アカウント削除では参照元も参照先も一緒に消えるので `SET NULL` は発動しない。`SET NULL` が意味を持つのは「参照先だけ消えて参照元が残る」個別レシピ削除のとき。

**運用メモ**: `codex exec`（Codex に修正させる）がこのセッションで長時間ハング（出力ゼロ・プロセス滞留）したため、指摘の修正は Claude が直接実施し、`codex review`（レビュー実行）だけ Codex を使った。`codex review` 自体は正常。

---

## 2026-09-06 認証画面（Issue #36）でfrontend-tsの認証状態・セキュアストレージを書くとき

**きっかけ**: Issue #36（frontend-ts 認証画面 ＋ セキュアストレージ ＋ Maestro E2E）の Codex レビュー（`--uncommitted`、17 巡）。同種の「副次的な後始末の失敗がメイン処理の結果を巻き込む」指摘が繰り返し出たため、CLAUDE.md にルール化した上でパターンとして残す。

1. **「永続化 → メモリ状態反映」の順序を徹底する**: ログイン・サインアップ・トークンリフレッシュのいずれも、`secureStorage` への書き込みが完了する前に `useSession` のメモリ状態を認証済みにしてはいけない。逆順だと、ストレージ書き込みが失敗したときに「画面はエラー表示なのにメモリ上はログイン済み」という不整合が起き、アプリを再起動するまで気づけない。
2. **「メイン処理に付随する後始末」と「メイン処理そのものの一部である永続化」を区別する**: 例えば非 remember なログインでの「別アカウントの古いトークンを消す」処理は前者（失敗しても今回のログイン結果を変えてはいけない＝ベストエフォート）、remember ありログインでの「今回発行されたトークンを保存する」処理は後者（失敗したらログイン自体を失敗として扱う）。この 2 つを同じ「エラーを投げっぱなしにする」実装にすると、ベストエフォートで良いはずの後始末の失敗でメイン処理の成功が握りつぶされる。CLAUDE.md に「副次的な後始末はベストエフォートにする」ルールとして明文化した。
3. **RefreshCoordinator の single-flight は「HTTP 呼び出しの完了」ではなく「後処理の完了」まで保護する**: 401 → refresh 成功後にトークンをストレージへ永続化する処理を `RefreshCoordinator` の外（呼び出し元）でやると、`inFlight` が HTTP レスポンス到着時点で解放されてしまい、永続化中に別の 401 が新しいリフレッシュを開始できてしまう（サーバーからは「使用済みトークンの再提示」＝reuse に見えてチェーン全体が失効する）。永続化・セッション反映は `RefreshCoordinator` に渡す関数（`refreshFn`）の中で完結させ、`inFlight` の保護範囲に含める。
4. **保護ルートへの直接ディープリンクを考慮し、認証復元はルートレイアウトで一度だけ起動する**: 「起動時にまず splash 画面を経由してから復元する」設計だと、OS のタスク再開やブックマークで保護ルートへ直接遷移された場合に splash がマウントされず、復元（`hydrated` を true にする処理）が永遠に走らない。認証復元の起動は `app/_layout.tsx`（全画面共通のルート）で行い、各画面はその結果（ストアの状態）を見るだけにする。
5. **openapi-fetch の `createClient()` は既定でその瞬間の `globalThis.fetch` を固定で覚える**: MSW（テストでのネットワークモック）は `globalThis.fetch` を `beforeAll` で後から書き換えるため、モジュール読み込み時に固定されたままだと差し替えが効かず、実際に動いている別プロセスのバックエンドにリクエストが飛んでしまう（テストがサイレントに間違った対象を叩く）。`fetch: (...args) => globalThis.fetch(...args)` という薄いラッパーを渡し、呼び出しのたびに読みに行くようにする。
6. **RNTL v14 では `render` / `renderHook` / `fireEvent.*` が軒並み非同期になっている**: React 19 の並行レンダリングに対応するため。`await` を付け忘れると、コンポーネントの初回エフェクトが走る前にアサーションしてしまい、原因不明に見えるテスト失敗になる。
7. **Expo Router のファイルベースルーティングは `*.test.tsx` もルートとして拾おうとする**: `src/app/` 配下にテストファイルを置く構成（このプロジェクトの慣習）だと、`expo export` / `expo start` の際にテストファイルが Metro でバンドルされ、jest グローバル（`expect` 等）未定義のまま実行されてクラッシュする。`metro.config.js` の `resolver.blockList` で `*.test.ts(x)` を除外する。CI の `frontend-ts.yml` は `npm run build:web` を実行するため、画面追加のたびにこの除外が効いているか気づきにくい（テスト自体は jest 側で独立して動くので気づけない）。
8. **Android の E2E（Maestro）は debug variant では動かない**: React Native の debug ビルドは Metro サーバーからバンドルを取得する前提のため、CI のエミュレータ単体（Metro 未起動）にインストールしても起動できない。`assembleRelease`（JS バンドルを APK に同梱）でビルドし、かつ `EXPO_PUBLIC_*` は「バンドルを生成する gradle タスクを実行するステップ」に渡す必要がある（`expo prebuild` の時点だけ渡しても、実際のバンドル埋め込みは `assembleRelease` 内で行われるため反映されない）。また Android 9 (API 28) 以降は平文 HTTP がデフォルト禁止なので、CI 専用に生成した `AndroidManifest.xml` にだけ `usesCleartextTraffic` を追記する（本番の `app.json` は変更しない）。
9. **Maestro は Web フローで `appId` の代わりに `url` を使う**（ベータ機能。管理下の Chromium を自動ダウンロードして開く）。モバイル用フローと Web 用フローは別ファイルに分ける。
10. **Maestro の Web 版は、React Native Web の複数テキスト入力欄でフォーカスの取りこぼしが再現性100%で起きる場合がある**（最終的に E2E ツール自体を乗り換える判断に至った）。症状: `tapOn: id: X` の直後に `inputText` すると、実際には直前の欄に文字が連結される（`commands.json` 上は両方とも `COMPLETED` と記録され、Maestro 自身はエラーを検知しない）。待機時間の延長（`extendedWaitUntil` / `waitForAnimationToEnd`）・`eraseText` による入力経路のウォームアップ・`tapOn` の連続実行、の 4 種類の対策を試したが、**Web 版は 3 回とも 1 文字単位まで完全に同一の壊れ方**、Android 版も特定の欄間（1 箇所）で同じ系統の不具合が再現性100%で起きた。同じ対策を 4 回試して結果が寸分違わず同じという事実が「たまたまの flaky」ではなく構造的な不具合だと判断する決め手になった。**対応**: Web は Playwright（`@playwright/test`）、Android は Appium（UiAutomator2）+ WebdriverIO に置き換えた。Playwright は実ブラウザを CDP で直接操作し `data-testid` をそのまま `getByTestId` で拾えるため同種の不具合が再現しなかった（0.7 秒で完走）。Android は Detox も検討したが、Expo SDK 57 に対応する `@config-plugins/detox` が無く（最新 11.0.0 でも `expo: ^53` までしか対応しない）SDK 互換性リスクがあったため、ビルド済み `.apk` を OS レベルから操作する「ブラックボックス」型で Expo/RN バージョンに依存しない Appium を採用した。**教訓**: E2E ツールで同じ症状が複数の異なる回避策に対して寸分違わず再現する場合、回避策を重ねるより先に「ツール側の既知の不具合」を疑い、代替ツールの技術選定（`resolve-tech-stack`）に切り替える判断を早めにする。
11. **Appium + WebdriverIO の Android で「`getPageSource` は正常なのに `findElement` が失敗する」→ 当初「ドライバの深い不具合」と誤診断したが、正体は `id` ロケータのパッケージ名補完だった**（Issue #57 で解明）。症状: 画面遷移後、`id=signup-email` のような `id` ロケータでの要素検索が `waitForDisplayed` / `isExisting` を問わず待機時間いっぱい失敗し続ける。一方 `getPageSource` の XML には当該要素が `resource-id="signup-email"` / `displayed="true"` で存在。当初は「`findElement` 系コマンド全般が壊れている」と解釈し、`continue-on-error` で非ブロッキング化して損切りした。**実際の原因**: PR #56 の CI で取得した Appium サーバーログ（artifact `appium-wdio-log`）を精査すると、(a) `-android uiautomator` 戦略（`new UiSelector().textContains(...)` / `.resourceId(...)`）の `findElement` は **200 で成功**、(b) `id` 戦略（`{"using":"id","value":"signup-email"}`）だけが **44ms で 404 即返し**（タイムアウトでも `waitForIdle` 待ちでもない）。RN の New Architecture は `testID` を接頭辞なしで `resource-id` に流すが、Appium の `id` ロケータは既定で `disableIdLocatorAutocompletion=false` のため `signup-email` → `com.recipi.app:id/signup-email` に補完してから探し、素の `resource-id` にマッチせず 404 になっていた。`findElement` 全般ではなく特定ロケータ戦略の設定ミス。**対応**: `wdio.conf.ts` の capabilities に `appium:disableIdLocatorAutocompletion: true` を追加（1 行）。`continue-on-error` を外してゲート化。**教訓**: 「`getPageSource` で見えるのに `findElement` が失敗」を見たら、まず **Appium サーバーログで「proxy される `strategy` / `selector` と HTTP ステータス・所要時間」を読む**。即 404（数十 ms）ならロケータの取り違え、待って失敗ならタイミング/idle 系、と切り分けられる。別戦略（`-android uiautomator`）で試すのも早い。「ドライバの深い不具合」「ツール乗り換え」に飛ぶ前に、まず 1 コマンドぶんの生ログを見る。ログを取る手段（失敗時の `getPageSource` / スクショ保存＋ appium.log の artifact 化）を最初から仕込んでおくと、この切り分けが CI ログだけで完結する。
12. **jest（+MSW）・Playwright（ブラウザ）のテストは、React Native の Hermes ランタイムでだけ壊れるコードを検知できない**（Issue #57、Android E2E を初めて実機で通したときに発覚）。`src/api/client.ts` の openapi-fetch レスポンスミドルウェアが `onResponse` から受け取った `response` をそのまま `return` していた。openapi-fetch 0.17 の契約は「差し替えるなら `new Response()`、変えないなら `undefined` を返す」で、`return response` は `!(result instanceof Response)` の判定に引っかかり **`Error: onResponse: must return new Response() when modifying the response` を throw** する。**Node（jest+MSW）とブラウザ（Playwright）では `instanceof Response` が通るので素通り**し、単体テスト 71 件・Web E2E は全部緑だった。Hermes では全 API 呼び出しがこの例外で失敗する（signup も login も）＝ネイティブアプリの HTTP レイヤーが一度も動いていなかった。**教訓**: (a) ライブラリの「ミドルウェア/フック契約」は破壊的変更が入りやすい。返り値のルール（何も返さない vs 加工して返す）はバージョン更新時に必ず確認する。(b) `instanceof` に依存するチェックは実行環境（グローバルコンストラクタの同一性）で結果が変わる。RN の Hermes は Node/ブラウザと別物。(c) **フロントに Hermes 上でしか出ない不具合クラスがある以上、Android/iOS の E2E を「あれば嬉しい」ではなく必須ゲートに入れる**。Web E2E だけでは不十分。
13. **Android 15+ の edge-to-edge に対して SafeArea 未対応だと、画面上端の固定ヘッダーが「見えているのに操作できない」要素になる**（Issue #57 → #58）。症状: `RecipeEditor` / レシピ詳細のアプリバー（`editor-save` / `editor-close` / `recipe-detail-header-back`）が、スクリーンショットには写っているのに Android のアクセシビリティツリーに現れず、TalkBack からも Appium からも到達できない。ツリー上は「子ゼロ・bounds が全画面」の `ViewGroup` になる。**原因**: `targetSdk 35+` では edge-to-edge が強制され、アプリの描画領域がステータスバーの下まで広がる。このプロジェクトは `react-native-safe-area-context` を依存に入れていながら `SafeAreaProvider` / `useSafeAreaInsets()` を**どこでも使っていなかった**ため、`y=0` 起点の固定ヘッダー（高さ 114px）がステータスバー（約 63px）に潜り込み、**システムウィンドウに隠れた領域のノードが a11y ツリーから剪定されていた**。`ScrollView` の中身は `y=114` 以降なので無傷 → 「ScrollView の中だけ取れる」という紛らわしい症状になる。**対応**: ルートレイアウトに `SafeAreaProvider`、固定ヘッダーを持つ画面で `useSafeAreaInsets().top` を `paddingTop` に加算。単体テストは `SafeAreaProvider` 無しで描画するので `jest.setup.js` でモックする。**教訓**: (a) これは a11y だけでなく**視覚的な UI バグ**でもある（ヘッダーがステータスバーと重なって表示されていた）。「E2E が要素を掴めない」は実 UI の欠陥のサインでありうる。(b) SafeArea / inset のような**横断的関心事はどの機能 Issue にも属さないまま抜け落ちる**。新規プロジェクトの scaffold 時点でチェックリストに入れる。(c) 切り分けでは `getPageSource` を**属性付きツリーとして整形して読む**（`bounds` / 子要素数 / `resource-id`）。「フォームの ScrollView が `y=114` から始まる」という 1 行が真因への入口だった。grep では見えない。(d) 実験の前に**エミュレータの安定性を確認する**。`device offline` → UiAutomator2 のクラッシュで判定不能な結果が混ざり、誤って仮説を棄却しかけた（4 コア / 4GB へ増やし Gradle デーモンを止めて解決）。(e) 変更が本当にビルドに入っているか、APK 内の `assets/index.android.bundle` を直接 grep して確認する。
14. **E2E が落ちたら、まず「アプリの実バグ」を疑う。ツールの不具合を疑うのは後**（Issue #57 で同じ誤診断を 2 回）。1 回目: `id` ロケータで要素が取れない → 「Appium / WebdriverIO のドライバの深い不具合」と判断して `continue-on-error` で損切りした。実際は Appium の id 補完設定（1 行）。2 回目: ヘッダーが a11y ツリーに出ない → 「react-native-screens のモーダルの不具合」「NativeWind の不具合」と 3 つのライブラリを疑った。実際はアプリの SafeArea 未対応。**どちらも実在するアプリ側の欠陥を、ツールのせいにして回避しようとしていた**。E2E の役割は実機での実バグ検出なので、失敗は原則「アプリが悪い」から入る。ツールを疑うのは、生ログ（Appium なら proxy される `strategy` / `selector` と HTTP ステータス・所要時間）で「アプリは正しいのにツールが誤動作している」ことを示せてから。
15. **品質ゲートを有効化するのは、そのゲートに含まれる全テストが緑になることを確認した後**（Issue #57 の実際の手順ミス）。`e2e-android.yml` の `continue-on-error: true` を作業の序盤で外したが、含まれる 2 spec のうち `recipe-crud` が通らないと分かったのは終盤だった。順序が逆で、「ゲートは有効だが赤」という宙ぶらりんの状態を長く抱えることになった。**関連する誤解の否定**: このとき「未実装の機能までテストしていたのが悪い、テストを実装範囲に絞るべき」という整理をしかけたが、それは**逆効果**。テスト対象（レシピ CRUD）は実装済みで、テストは正しく実バグ（SafeArea 未対応）を見つけていた。実装範囲に絞っていたら、この不具合も Hermes の HTTP レイヤー不具合（上記 12）も**両方取り逃していた**。スコープの問題は「テストを狭める」ではなく「**ゲートの有効化タイミング**」と「**別 Issue への切り出し**」で解く。

## 2026-09-09 保存エラーのポップアップ（Issue #63）でスクロール移動を実装するとき

レシピ編集画面で「保存に失敗したらポップアップで知らせ、最初のエラー欄まで移動する」を実装したときの記録。**移動先がずれる問題の原因究明に時間を使ったので、同じ轍を踏まないための記録が主眼**。

1. **画面外のエラーは「無い」のと同じ**。保存ボタンが固定ヘッダーにあり画面のどこからでも押せる一方、エラーは各欄の直下と先頭にしか出していなかった。#40 でサムネイル枠（4:3）が大きくなったこともあり、下の方で保存すると何も見えず「押しても反応しない」と受け取られた。**固定ヘッダーから起動する操作の結果は、スクロール位置に依存しない場所（ダイアログ等）にも出す。**

2. **`Record<localId, メッセージ>` は並び順を持たない**。エラーを一覧表示するには、フォーム状態と突き合わせて画面順に並べ直す必要がある。この並べ替えと「材料 1-2」「手順 3」という位置の言い換えは純粋関数（`collectFormErrors`）に切り出すと、順序と文言だけを単体テストできる。

3. **React Compiler の `react-hooks/refs` は描画中の ref 読み取りを禁じる**。「キーごとに ref コールバックを作って使い回す」ために描画中 `ref.current` の Map を引く書き方は lint エラーになる。固定の欄は `useCallback` でコールバックを個別に固定し、動的に増減する行は行側へ登録関数を渡す形にした。

4. **スクロール移動が効かないときは「誰が最後にスクロールしたか」を実測する**。移動先がずれる原因を、コードを読むだけでは特定できなかった。`scroll` と `focusin` にリスナーを張ってタイムスタンプ付きで記録したところ、次の順序が見えて一発で確定した。

   | 時刻 | 出来事 |
   | --- | --- |
   | t=1251 | 自分のスクロールは**正しい位置**（1190）に移動していた |
   | t=1469 | モーダルが**遅れて**フォーカスを直前の入力欄へ復帰 |
   | t=1485 | ブラウザがその欄を画面内へ戻し、位置が上書きされた |

   **推測で実装を差し替えず、時系列を測る。** 実際この過程で「`measureLayout` の相対計算が悪い」「スムーススクロールが中断している」と 2 回誤診し、どちらも真因ではなかった。

5. **モーダルは閉じるときにフォーカスを元の要素へ戻し、ブラウザはそれを画面内へスクロールする**。しかもその復帰は数百ミリ秒遅れて来るので、閉じた直後のスクロールは後から打ち消される。対策は**ダイアログを出す前にフォーカスを外しておく**こと（戻す相手をなくす）。閉じたあとに待つ・外す方法は復帰の方が後に来るため効かない。

6. **`react-native-web` の `Keyboard.dismiss()` は web では当てにならない**。`TextInputState._currentlyFocusedNode` は RN の `TextInput.focus()` 経由でしか更新されず、利用者の操作やブラウザのフォーカス復帰では設定されない。そのため `currentlyFocusedField()` が `null` を返し、`dismiss()` が何もしないことがある。web でフォーカスを確実に外すなら DOM の `blur()` を `Platform.OS === "web"` の分岐で呼ぶ。

7. **位置測定は座標系を 1 つに揃える**。`measureLayout` の相対計算は親の `offsetParent` 連鎖とスクロール量の相殺に依存する。`measureInWindow` で「対象 − 内容の原点」を取れば座標系がウィンドウだけで済み、内容が縦に長くても素直に読める。原点用に自前の `View` を 1 枚挟むと、ライブラリ内部のノード取得（`getInnerViewNode`）に依存しなくて済む。

8. **移動は `animated: false` にする**。滑らかスクロールは、ダイアログが閉じて欄の下にエラー文が入る（＝レイアウトが動く）タイミングで中断され、途中で止まることがある。確実に着くことが優先。

9. **ダイアログを足すと既存テストの `findByText` が多重マッチで落ちる**。同じ文言が「欄の直下」と「ダイアログ」の 2 か所に出るため。件数を問う `getAllByText(...).length` か `testID` 起点に直す。**これは実装前に予見できる影響なので、計画時に洗い出しておく。**

10. **一覧は上限を設ける**。エラーが多いとダイアログが画面を覆い、かえって「まず何を直すか」が分からなくなる。5 件＋「ほか N 件」に丸めた。
