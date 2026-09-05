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

---

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
