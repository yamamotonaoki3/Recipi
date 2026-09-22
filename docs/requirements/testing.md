# テスト / CI・CD 方針

> 実装（Phase 0〜）で満たすテストの方針。各機能の受け入れ基準は `features/*.md`、処理の設計は [processing-model.md](processing-model.md) を正とし、この文書は「どのレイヤーで・どの技法で・どう自動化して品質を担保するか」を定める。
>
> **ツールは 2026-09-03 に確定**（下表）。バージョンは各 Phase の scaffold 時に固定し、このマシンでの利用可否を検査する（フロントのバージョンを確定したのと同じ流れ。[tech-stack.md](tech-stack.md)）。

## 1. テストのレイヤー

| レイヤー                      | 目的                                                             | backend（Python / FastAPI）                                                                                                                                                                           | frontend-ts（Expo / React Native）                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **品質チェック（静的解析）**  | 実行しなくても分かる誤り・スタイル崩れを機械的に弾く             | **ruff**（lint ＋ `format --check`）、**mypy**（型チェック）                                                                                                                                          | **ESLint**（Expo 設定）、**Prettier `--check`**、**`tsc --noEmit`**（型チェック）                                                                                   |
| **単体テスト（unit）**        | 関数・クラス・hook・コンポーネントを単体で検証。外部依存はモック | **pytest**。純粋関数（正規化・単位整形・カーソルのエンコード）、Pydantic モデルのバリデーション、サービス層のロジック（DB はモック / インメモリ）                                                     | **jest-expo ＋ @testing-library/react-native**。表示整形などの util、hooks、コンポーネント（API は MSW でモック）                                                   |
| **結合テスト（integration）** | 複数の部品を実際につないで検証。DB・ストレージは本物             | **pytest ＋ 実 PostgreSQL**（Alembic マイグレーションを適用したテスト DB）＋ **MinIO**。API を `httpx` ＋ `ASGITransport` で直接叩き、認証フロー・CRUD のトランザクション・カウント列・CASCADE を検証 | **MSW** で生成 API クライアントをモックし、画面 → API 呼び出し → 状態更新（TanStack Query のキャッシュ / 無効化）→ 再描画 の一連を検証                              |
| **E2E テスト**                | ユーザーがアプリを操作する流れを端から端まで検証                 | —                                                                                                                                                                                                     | Web = **Playwright**、Android = **Appium + WebdriverIO**。`infra/docker-compose.yml` のフルスタック（api ＋ postgres ＋ minio）に対し、Phase ごとの主要フローを実行 |
| **契約テスト（contract）**    | backend の API 契約とフロントの生成コードのズレを検知            | CI で FastAPI から `openapi.json` を再生成し、コミット済みと一致するか（`git diff --exit-code`）                                                                                                      | CI で `openapi-typescript` を再実行し、生成物（`expoApp/src/api/schema.ts`）に差分が出たら失敗（[todo.md](todo.md) #42）                                            |

> 「単体」「結合」の線引きが曖昧なケースは、**実 DB につなぐなら結合、つながないなら単体**で分類する。

## 2. テスト設計方針（ブラックボックス / ホワイトボックス併用）

「同値分割」「境界値分析」などのテスト技法をはじめて使う場合の考え方は下記のとおり。**両方を併用**する。

### ブラックボックステスト（仕様ベース・内部実装を見ない）

- **出所**: `features/*.md` の受け入れ基準、[api.md](api.md) ＋ 各 features の「API」節、画面仕様（[screens/](screens/)）。
- **技法**:
  - **同値分割** — 入力を「同じ結果になるグループ」に分け、各グループから代表値を 1 つ選ぶ。例: 何人分の入力を「範囲内（1〜99）」「小さすぎ（0 以下）」「大きすぎ（100 以上）」「非数値」の 4 グループに分け、それぞれ 1 ケース。
  - **境界値分析** — グループの境目でバグが出やすいので、境界のちょうど内側・外側を突く。例: タイトル 1〜120 字 → `{0, 1, 120, 121}` 文字。`items` 200 件上限 → `{200, 201}` 件。`limit` 1〜50 → `{0, 1, 50, 51}`。
  - 検索の「スペース無しは 1 語」「全角スペースも区切り」「大文字小文字・全半角の同一視」など、仕様に明記された挙動をそのままケースにする。
- **主担当**: 結合テスト（API レベル）と E2E。フロントのコンポーネントテストも「表示仕様どおりか」で書く。

### ホワイトボックステスト（実装ベース・分岐や状態を見る）

- **出所**: 実装の条件分岐・状態遷移、[processing-model.md](processing-model.md) のトランザクション設計。
- **技法**:
  - **分岐網羅（branch coverage）** — `if` の真・偽の両方、`match` の各腕、早期 return の経路を、それぞれ最低 1 回は通す。
  - 状態機械を明示的に突く。例:
    - カウント列トランザクションの「実際に 1 行増減した」分岐と「`ON CONFLICT DO NOTHING` で何もしなかった」分岐（[processing-model.md](processing-model.md) §2）。
    - 一時アップロードの `pending` → `stored` → `consumed` と、途中の各失敗経路（[processing-model.md](processing-model.md) §9）。
    - GC の「行をロック → 再確認 → `consumed` なら対象外」。
    - トークンのローテーション正常系 / 消費済みトークンのリユース検知でチェーン失効 / `token_version` 不一致で 401（[features/auth.md](features/auth.md)）。
    - `deadlock` / `serialization_failure` のサーバー側リトライ。
- **主担当**: 単体テスト。

### 各イシューでの扱い

各実装イシューのテスト要件に「**BB**（受け入れ基準・境界値）＋ **WB**（分岐・状態遷移）」を両方書く。PR のセルフレビューで「仕様の代表ケースを網羅したか」「主要な分岐を通したか」の 2 観点を確認する。

## 3. カバレッジ

- PR ごとに計測する。backend は `test` ジョブが結果を **PR にコメント**する（Issue #86）。全体の行・分岐と下限・合否、この PR で変わった `backend/app/` のファイルごとの行・分岐を出し、CI を再実行すると同じコメントを更新する（増やさない）。
  - 本文は `backend/scripts/coverage_comment.py` が `coverage.json` から作り、計算は `check_coverage.py` と同じ関数を使う（コメントの合否と CI の合否が一致する）。投稿は `gh api`（外部 Action は使わない）。
  - コメントは補助なので、本文作成・投稿に失敗しても CI は落とさない（合否は下限判定だけ）。フォーク・Dependabot の PR はトークンが読み取り専用のため投稿しない。
  - backend に関係ない PR（`test` ジョブがスキップされる）ではコメントしない。frontend のコメントは未対応。
- **行カバレッジと分岐カバレッジの両方**でゲートする。下限を割ったら CI を失敗させる。
  - backend: `pytest --cov-report=json` の結果を `backend/scripts/check_coverage.py` が行・分岐それぞれ下限と比べる（`--cov-fail-under` は行と分岐の合算しか見ないため使わない。Issue #76）
  - frontend: jest の `coverageThreshold`（`lines` / `branches` を別々に判定）。`npm test -- --coverage` のときだけ判定される
- **現行の下限（Issue #76 で MVP 完成時の目標値に確定）**: backend 行 85% / 分岐 75%、frontend 行 75% / 分岐 65%。
- 開始時の下限（履歴。Phase 1）: backend 合算 70%（`--cov-fail-under`）、frontend 行 60% / 分岐 50%。
- 数値は実装しながら現実に合わせて調整してよい（下げる場合は PR にその理由を書く）。カバレッジは目安であって、**BB/WB の観点で必要なケースが書けているか**を優先する。

## 4. テストデータ規約

[non-functional.md](non-functional.md) 「テストデータ規約」＋ グローバル `~/.claude/CLAUDE.md` 「テストデータの標準要件」に従う（[environment.md](environment.md) にも再掲）。

- メールは `@example.com` / `@example.org` / `@example.net` のみ。
- ユーザー名は `testuser_%` / `e2euser_%` 接頭辞、本文に `[E2E_TEST]` 等のタグ。
- パスワードは `TestPass123!` のようなテスト専用固定値。
- 識別子ベースで一括削除する `cleanup`（SQL / スクリプト）を用意し、テスト後に残数 0 を確認する。
  - E2E: `backend/scripts/cleanup_e2e.py`（Issue #135）。`e2euser_…@example.com` のユーザーとその持ち物を物理削除し、残数 0 を確かめる。`backend` で `APP_ENV=development python -m scripts.cleanup_e2e --run-id <id> --yes`（1 回の実行分）／`E2E_CLEANUP_ALLOW_ALL=1 … --all --yes`（全部）。`--dry-run` で件数だけ見られる。接続先がローカル以外・E2E 以外の行に 1 件でも触れる場合は何も消さない。CI（`e2e.yml` / `e2e-android.yml`）はテスト後に毎回 `--all` で実行する
  - 性能テスト: `backend/scripts/cleanup_perf.py`（Issue #145）。`perfuser_…@example.com`（本文は `[PERF_TEST]`）を対象に、E2E と同じ `cleanup()`（安全装置・残数 0 の確認）で消す。投入は `seed_perf.py`（§9）
- **テストは本番・ステージング DB に接続しない**。接続先はローカル（Docker）または CI の使い捨て DB に限定し、接続文字列をテストコードから確認できるようにする。

## 5. CI（GitHub Actions）

`.github/workflows/` に配置する。

| ワークフロー      | トリガー                                                              | 内容                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend.yml`     | `backend/**` を含む push / PR                                         | Dockerイメージのビルド・非root起動・`/healthz`確認 → ruff（lint・format）→ mypy → Alembic マイグレーション → pytest（単体 ＋ 結合を 1 回で実行。`services: postgres` ＋ MinIO コンテナ、`.env.test` は CI で生成）→ `check_coverage.py` で行・分岐の下限を判定 → PR にカバレッジをコメント（#86） |
| `frontend-ts.yml` | `expoApp/**` を含む push / PR                                         | `checks` ジョブ: ESLint → Prettier `--check` → `tsc --noEmit` → jest（単体・結合、`--coverage` で行・分岐の下限を判定）→ Web ビルド（`npm run build:web`）                                                                                |
| `contract.yml`    | backend / `openapi.json` / 生成設定の変更                             | `openapi.json` 再生成の diff チェック（Phase 0）＋ `schema.ts` 再生成の diff チェック（frontend 導入後）                                                                                                                                  |
| `e2e.yml`         | `expoApp/**` / `backend/**` / `infra/**` / `openapi/**` の PR ／ 手動 | docker-compose でフルスタック起動 → **Web（Chromium / Playwright）** の E2E フロー実行 → E2E データの後始末（`cleanup_e2e.py`、残数 0 を確認）                                                                                            |
| `e2e-android.yml` | **手動（`workflow_dispatch`）**                                       | docker-compose でフルスタック起動（`docker-compose.e2e-android.yml` で `ACCESS_TOKEN_TTL_SECONDS=60` を注入。Issue #246） → `expo prebuild` → release APK ビルド（Gradle cache）→ エミュレータ（AVD snapshot cache）→ **Android（Appium + WebdriverIO）** の E2E フロー実行                                                       |
| `tauri.yml`       | **手動（`workflow_dispatch`）**                                       | Web ビルド → Tauri の Rust を `cargo check`                                                                                                                                                                                               |

- **通常 PR のトリガー**: `pull_request`（→ `main`。マージの必須チェックにする）＋必要な feature ブランチへの `push`。
- **時間のかかるプラットフォーム検証**: Android E2E と Tauri は通常 PR の必須チェックから外し、Phase 完了時・リリース前・各プラットフォーム固有または認証・ナビゲーション・API クライアントなど共通基盤の変更時に手動実行する。手動結果が必要な変更は、成功を確認してからマージする。
- **パスフィルタ**: `backend/**` の変更で frontend ジョブを回さない（逆も同様）。共通ファイル（`openapi.json` 等）は両方を回す。
  - **push** は従来どおりワークフローの `paths` で絞る。
  - **PR** は `paths` で絞らず、ワークフローは毎回起動する（Issue #87）。各ワークフローの `changes` ジョブが `scripts/ci/changed.sh` で変更ファイルを判定し、関係ない変更なら本体のジョブを**条件でスキップ**する（スキップされたジョブは必須チェック上「成功」扱い）。`paths` で起動しないと必須チェックが「待ち」のままになり、docs だけ・backend だけの PR がマージできなくなるため。
  - `.github/workflows/` と `scripts/ci/` の変更では全ジョブを走らせる。判定が失敗した（変更ファイルが取れない）ときも、安全側で本体を全部走らせる（判定の失敗で素通りさせない）。
- **ブランチ保護**: `main` への直接 push・削除・force push の禁止 ＋ 次の 5 つを**必須チェック**にする（Issue #87 で設定）: `test`（backend）/ `checks`（frontend-ts）/ `openapi-in-sync`・`schema-ts-in-sync`（contract）/ `web`（e2e）。手動の `android`・`tauri`・`msi` は必須にしない（上の方針）。
  - **ジョブ名（＝チェック名）は変えない**。変えると必須チェックが永久に「待ち」になる。変えるときはブランチ保護の設定も同時に直す。
  - 「main の最新に追いついていること」（`strict`）は求めない。1 人開発で毎回の取り込み直しは負担が大きく、main は squash マージのみで衝突は PR 側で気づけるため。
  - 管理者は保護を迂回できる設定（`enforce_admins: false`）のままにする。緊急時の逃げ道で、通常は使わない。使ったときは PR に理由を書く。
- **今回のセッション（Issue #240〜#285）で追加した E2E シナリオ**:
  - Web: `security-question-api.spec.ts`（#240）、`email-change-api.spec.ts` / `email-change.spec.ts`（#241・#243・#275・#276）、`retap-scroll.spec.ts`（#249）、`avatar-crop.spec.ts`（#251）、`static-routes.spec.ts`（#267。動的ルートの配信検証）。既存 `recipe-crud.spec.ts` に画像が実際に読み込めたかの検証（`naturalWidth > 0`）を追加（#268）。
  - Android: `token-refresh.e2e.ts`（#246。401→リフレッシュ→リトライの実機検証）、`home-subtab-swipe.e2e.ts`（#250）、`avatar-crop.e2e.ts`（#251・#285。写真ピッカー操作を含む）。
  - Web のコンソール監視（`console-guard.ts`、#247）を frontend 系 Issue の前提として導入。一時許可（`KNOWN_ISSUES`）に入れていた React #418（#267）・minio 名前解決失敗（#268）はいずれも原因を特定して解消し、許可を削除済み。
- **ローカルでの再現**（CI と同じ内容）: `backend/` は `ruff check .` / `ruff format --check .` / `mypy .` / `pytest --cov-report=json` → `python -m scripts.check_coverage coverage.json --lines 85 --branches 75`、`expoApp/` は `npm run lint` / `npm run format` / `npm run typecheck` / `npm test -- --coverage`。E2E は `npm run e2e:web`（Playwright）/ `npm run e2e:android`（要 Appium サーバー起動・エミュレータ）。手順はルート `README.md`（Issue で作成）。
  - **Android E2E で短い TTL を使う場合**（`token-refresh.e2e.ts`、Issue #246）: `infra` で `docker compose --env-file ../.env.development -f docker-compose.yml -f docker-compose.e2e-android.yml up -d --build api` として `api` を起動する（`ACCESS_TOKEN_TTL_SECONDS=60` が注入される）。反映確認は `docker compose --env-file ../.env.development -f docker-compose.yml -f docker-compose.e2e-android.yml config` で `api.environment.ACCESS_TOKEN_TTL_SECONDS: "60"` を見る。このoverrideを当てると、他の Android spec も 60 秒を超えれば実際に refresh を通る（意図した設計。「実害なし」ではない）。
  - **Android E2E で写真ピッカーを使う場合**（`avatar-crop.e2e.ts`、Issue #251。写真アップロード自体は #285 で修正）: エミュレータのギャラリーに事前に写真を 1 枚入れておく必要がある。`adb push <画像> /sdcard/Pictures/avatar-src.jpg` の後、`adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/avatar-src.jpg` でメディアスキャンを走らせる（スキャンしないとシステムの写真ピッカーの「最近」に出てこない）。CI（`e2e-android.yml`）もこの手順で用意する。
  - **ホストで直接 `uvicorn` を起動したまま Android E2E を回さない**: `127.0.0.1:8000` を掴む野良プロセスがあると、エミュレータの `10.0.2.2:8000` 宛のリクエストがそちらに解決され、Docker の `api` コンテナ（`0.0.0.0:8000`）ではなく古い設定のプロセスが応答することがある（Issue #251 の実機確認で発見。画像 URL のホストが食い違い、署名なしの安定 URL でも読み込めなかった）。`netstat -ano | grep :8000` で複数プロセスが listen していないか確認する。

## 6. CD（継続的デリバリー）

- **本番は AWS**（[architecture.md](architecture.md) §本番デプロイ）。backend のデプロイは **手動実行のワークフロー** `.github/workflows/deploy-backend.yml`（Issue #167）で行う。ECR への push → タスク定義の更新 → マイグレーション → ECS サービスの更新 → `/healthz`・`/healthz/db` の確認までを 1 回で行い、失敗したら前のタスク定義に戻す。
- **main への push で自動デプロイはしない**（学習用で、確認するときだけ環境を立てて後で destroy する運用のため）。**マージの必須チェックは従来の 5 件のまま**で、デプロイのワークフローは含めない。
- 通常の CI 側は引き続きビルド / パッケージ検証を行う:
- backend: Docker イメージの `build`、非rootユーザーでの起動、`/healthz` が通ること。`backend/.dockerignore` は環境ファイル・テスト成果物・仮想環境をビルドコンテキストから除外する。
  - frontend: `expo export`（Web ビルド）＋ `tauri build`（未署名デスクトップパッケージ）のスモーク。
- `infra/**` を変更する PR では Terraform の `fmt -check` / `validate`（`.github/workflows/terraform.yml`）。AWS には接続せず、`apply` もしない。
- frontend は配布物（`.msi` 等）を手動ワークフローの artifact として取り出す運用で、ストア配布は対象外。
- デモ用のデスクトップパッケージ（未署名 `.msi` / `.dmg`）は MVP 時点でも上記スモークの成果物として取り出せる（[roadmap.md](roadmap.md) 「MVP ライン」）。

## 7. ツール一覧（確定）

| 用途                           | 採用                                                                                     | 備考                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| backend lint / format          | **ruff**                                                                                 | 2026 の Python 標準。`pyproject.toml` に設定                                                                                                                                                             |
| backend 型チェック             | **mypy**                                                                                 | strict 寄せの度合いは実装時に調整                                                                                                                                                                        |
| backend テスト                 | **pytest**（＋ `pytest-asyncio` / `pytest-cov` / `httpx`）                               | 結合は `ASGITransport` で FastAPI を直接叩く                                                                                                                                                             |
| backend 結合の DB / ストレージ | GitHub Actions `services:`（postgres）＋ MinIO コンテナ                                  | `testcontainers` は使わない（ランナー標準の services で足りる）。MinIO は `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`（compose と同じタグで固定。[environment.md](environment.md) §4・Issue #89） |
| frontend lint / format         | **ESLint**（Expo 設定）＋ **Prettier**                                                   |                                                                                                                                                                                                          |
| frontend 型チェック            | **`tsc --noEmit`**                                                                       |                                                                                                                                                                                                          |
| frontend テスト                | **jest-expo ＋ @testing-library/react-native**                                           | Expo 標準。vitest は使わない                                                                                                                                                                             |
| frontend API モック            | **MSW**（Mock Service Worker）                                                           | 生成した API クライアントの下でネットワークをモック                                                                                                                                                      |
| E2E（Web）                     | **Playwright**（`@playwright/test`。Apache 2.0 の無料 OSS）                              | 実ブラウザを CDP で直接操作。React Native Web の `data-testid` を `getByTestId` でそのまま拾える                                                                                                         |
| E2E（Android）                 | **Appium**（UiAutomator2 ドライバ）＋ **WebdriverIO** （いずれも Apache 2.0 の無料 OSS） | ビルド済み `.apk` を OS レベルから操作する「ブラックボックス」型のため Expo / React Native のバージョンに依存しない。ホスティング型クラウド（有料）は使わない                                            |
| 契約                           | `openapi-typescript`（フロント）／ FastAPI 標準出力（backend）                           | [tech-stack.md](tech-stack.md) 「型共有」                                                                                                                                                                |
| 性能テスト                     | **k6** v2.1.0（Grafana k6。AGPL-3.0 の無料 OSS）                                         | シナリオは JavaScript。閾値（p95 など）で合否を判定できる。単体のバイナリなのでプロジェクトの依存には入れない（§9・Issue #145）                                                                         |

## 8. 確定済み・未確定（`resolve-tech-stack` で確定）

**確定済み**（TS トラック・backend の MVP 実装で確定した項目。Kotlin トラックの選定は [todo.md](todo.md) #5・#7 の「未定」を参照）:

- バージョンの決め方: backend の Python パッケージは `backend/requirements*.txt` で `==` 固定、frontend は `expoApp/package.json` の指定（`^` / `~`）＋ `package-lock.json` で固定（[todo.md](todo.md) #5）
- JWT ライブラリ = **PyJWT**（[todo.md](todo.md) #41）、PostgreSQL = **18**（[todo.md](todo.md) #5）
- フロントの状態管理 = **Zustand**（クライアント状態）＋ **TanStack Query**（サーバーデータ）（[todo.md](todo.md) #7）

**未確定**:

- iOS はこの学習プロジェクトでは対象外のため、iOS シミュレータの自動検証は行わない（[todo.md](todo.md) #3・#51）。Web は通常 PR の自動 CI、Android は手動 Workflow で検証する。

## 9. 性能テスト（k6）

非機能要件「レシピ一覧 / フィード API は通常時 300ms 以内（ローカル環境目安）」（[non-functional.md](non-functional.md) §パフォーマンス）を確かめる。

- **対象**: 閲覧の流れ（ホーム「全体」フィードを 3 ページ → 材料名で検索 → レシピ詳細）と、公開レシピ作成後の通知 fan-out の探索的測定（Issue #248）。ログインは最初にまとめて行い、測定の対象にしない（Argon2id がわざと重いため）。
- **環境**: ローカルの Docker Compose（api + postgres + minio）、`APP_ENV=development`。**CI には入れない**（共有ランナーは性能が安定せず、300ms の判定がぶれるため）。手元で手動実行する。
- **テストデータ**: 閲覧系は `seed_perf.py` の既定（ユーザー 200 人・公開レシピ 3,000 件）。fan-out は `--users 1001 --hub-followers 0|10|100|1000` とし、投稿者 `perfuser_001` の実フォロワー数だけを水準ごとに変える。いずれも `perfuser_…@example.com` / `[PERF_TEST]` を使い、終了後は `cleanup_perf.py` で残数 0 を確かめる（§4）。
- **スクリプト**: `backend/perf/k6/`。共通部品は `lib/`（設定・ログイン・閲覧シナリオ）。閲覧リクエストには `name` タグ（`feed` / `search` / `detail` / `login`）、fan-out投稿には `fanout-post` を付ける。fan-out のDB確認は、k6ログの `recipe_id` を `python -m scripts.verify_fanout` に渡して別トランザクションで行う。
- **トークン**: アクセストークンは 15 分で切れるので、発行から 10 分たったら VU がログインし直す（15 分を超えるテストでも 401 にならない）。

| テスト     | スクリプト        | 負荷                  | 合否の基準                                        | Issue |
| ---------- | ----------------- | --------------------- | ------------------------------------------------- | ----- |
| スモーク   | `smoke.js`        | 1 VU・1 分            | HTTP の失敗 0 件・check がすべて成功             | #145  |
| 平均負荷   | `average-load.js` | 15 VU（平常＝100%）。1 分で上げ → 5 分保つ → 1 分で下げる | feed / search の p95 < 300ms・失敗率 < 1%・check 99% 超 | #146  |
| ストレス   | `stress.js`       | 30 VU（200%）→ 45 VU（300%）。各 5 分保つ（合計 16 分） | feed / search の p95 < 600ms・失敗率 < 1%・5xx（`server_errors`）0 件 | #147  |
| スパイク   | `spike.js`        | 15 VU → 10 秒で 100 VU（約 670%）→ 1 分保つ → 15 VU に戻して 2 分 | 全体の失敗率 < 5%・回復区間（`phase:recovery`）の feed / search の p95 < 300ms | #148  |
| fan-out探索 | `fanout.js` | 1 VU・3回。フォロワー数 0 / 10 / 100 / 1,000 を別実行 | 投稿201・outbox処理済み・通知件数が指定数と一致。p95や移行閾値は判定しない | #248 |
| fan-out厳密測定 | `fanout-strict.js` | 固定到着率（既定1 req/s）・5分。0フォロワーを対照にして各水準を専用DBで別実行 | `dropped_iterations=0`・投稿失敗0・DB検証でoutbox処理済み、通知件数・受信者集合一致。API 201だけでは成立としない。**本格実施はしない（確定・下記参照）。手順は参考として残す** | #260 |

- **スパイクで見ること**: 急に増えてもプロセスが落ちないか、平常に戻った後に自力で元の速さへ戻れるか。k6 の `scenarios` を 2 つ（`spike` → `recovery`）に分け、回復区間のリクエストだけに `phase:recovery` タグを付けて判定する。急増中のエラーの内訳（タイムアウト / 5xx / 接続拒否）と、回復までにかかった時間を下の測定結果に書く。終わった後に `GET /healthz` が応答することも確かめる。

- **ストレスで見ること**: 壊れずに（5xx を出さずに）緩やかに遅くなるか。段階ごとの p95 と、最初に詰まった箇所（DB の接続数・Uvicorn のワーカー・CPU）を下の測定結果に書く。段階ごとの値は、k6 の結果を時間で区切って読む（`--out csv=<出力先>` で時刻付きの生データを出せる）。

- **平常＝15 VU は仮の値**。本番のアクセス量のデータがまだ無いため、同時に閲覧している人を 15 人と置いた（1 回の閲覧のあとに `THINK_TIME` 秒休む）。実際の量が分かったら見直す。

### 実行手順

```bash
# 1. バックエンド一式を起動し、マイグレーションを適用しておく（README の手順）
# 2. テストデータを入れる（backend で実行）
cd backend
APP_ENV=development python -m scripts.seed_perf --yes
# 3. k6 を実行する（リポジトリルートで。値は -e で上書きできる: BASE_URL / PERF_PASSWORD / PERF_USERS / THINK_TIME）
k6 run backend/perf/k6/smoke.js
# `seed_perf.py --users` を変えたら、k6 に `-e PERF_USERS=<同じ数>` を渡す。
# 4. 後始末（残数 0 を確認）
cd backend
APP_ENV=development python -m scripts.cleanup_perf --yes
```

fan-outを探索的に測る場合は、各フォロワー数を別々に投入・測定・検証する。

```bash
cd backend
APP_ENV=development python -m scripts.seed_perf --users 1001 --recipes 1 --hub-followers 1000 --yes
cd ..
k6 run -e PERF_USERS=1001 -e FANOUT_ITERATIONS=3 backend/perf/k6/fanout.js
# k6のログに出た各 recipe_id を、expected-followers と合わせて確認する
cd backend
APP_ENV=development python -m scripts.verify_fanout <recipe_id> --expected-followers 1000
APP_ENV=development python -m scripts.cleanup_perf --yes
```

0 / 10 / 100 / 1,000 の各水準で同じ手順を繰り返す。fan-out探索の値は単一マシン・少数回・ローカルDBの結果であり、p95や専用ジョブキューへの移行閾値の根拠にはしない。**専用ジョブキューへの移行は行わないと確定した**（学習用アプリで実運用負荷が想定されないため。[todo.md](todo.md) #18・#50）。以下の厳密測定・移行開始条件の手順は、費用対効果の判断のため実施しない。今後測定が必要になった場合の参考として手順のみ残す。

厳密測定では、他の定期処理を止めた専用DBを用意し、0フォロワーを対照としてから、固定到着率で水準ごとに実行する。
`dropped_iterations` が1件でもあれば投入量未達として測定不成立とする。k6ログに出た全ての
`recipe_id` を `verify_fanout.py` で確認し、処理済み outbox、通知件数、実際の受信者集合が
期待値と一致した場合だけ成立とする。測定終了後は未処理件数、最古未処理行の年齢、排出時間を
別トランザクションで記録し、`cleanup_perf.py --yes` で残数0を確認する。

```bash
# 専用DB・固定データを用意した環境で、1 req/s・5分を実行する例
k6 run -e PERF_USERS=1001 -e FANOUT_RATE=1 -e FANOUT_DURATION=5m backend/perf/k6/fanout-strict.js
# 出力された全 recipe_id を expected-followers とともに検証する
cd backend
APP_ENV=development python -m scripts.verify_fanout <recipe_id> --expected-followers 1000
```

- k6 は単体のバイナリ（Windows は `winget install k6`）。バージョンは `k6 version` で確認する。
- スモークが通るまでは、ほかのテストを実行しない（スクリプトやデータの誤りを負荷の問題と取り違えないため）。
- 結果を残すときは `--summary-export <出力先>.json` を付ける（例: `k6 run --summary-export perf-average-load.json backend/perf/k6/average-load.js`）。**出力はコミットせず、数値だけを下の「測定結果」に書き写す。**
  - **理由: summary の JSON にはアクセストークンがそのまま入る**。`backend/perf/k6/lib/auth.js` の `loginAll()` が返したトークンの一覧が、k6 の `setup()` の戻り値として `setup_data.tokens` に載るため（#196 の結果 6 件には合計 262 個の JWT が入っていた）。失効済み・テスト用ユーザーのものであっても、グローバル CLAUDE.md「秘密情報の標準取り扱い要件」の「テスト用・開発用だから安全と判断しない」に従い、コミット対象のファイルには置かない。
  - 書き写したあとの JSON は破棄する。リポジトリ外であっても、作業用の一時ディレクトリに置いたままにしない。

### 測定結果（ベースライン）

今後の変更で遅くなっていないかを比べる基準。**ローカルの Docker 環境での値で、本番の応答時間を保証するものではない**。

#### 通知 fan-out 探索（Issue #248）

2026-09-21、Windows 11 の開発機、ローカルDockerのPostgreSQL 18・API 1コンテナ、k6 v2.1.0で測定した。各水準は1 VU・3回、`--users 1001` とし、投稿者 `perfuser_001` のフォロワー数だけを変更した。投稿APIの値は `fanout-post` の観測値、outboxは `verify_fanout.py` で対象recipe_idを別トランザクションから確認した値である。

| フォロワー数 | 投稿API avg / min / max (ms) | outbox完了 avg / min / max (秒) | 通知件数 | 成立 |
| ------------ | ----------------------------: | -------------------------------: | -------: | ---- |
| 0            | 36.97 / 20.30 / 66.47         | 0.036 / 0.021 / 0.064             | 0 / 0 / 0 | 3/3 |
| 10           | 19.50 / 17.76 / 22.48         | 0.021 / 0.018 / 0.023             | 10 / 10 / 10 | 3/3 |
| 100          | 20.31 / 18.72 / 21.70         | 0.021 / 0.021 / 0.022             | 100 / 100 / 100 | 3/3 |
| 1,000        | 20.91 / 20.09 / 21.95         | 0.035 / 0.034 / 0.036             | 1,000 / 1,000 / 1,000 | 3/3 |

これはフォロワー数の桁を把握するための探索結果であり、サンプル数が少ないため p95 や移行閾値は名乗らない。単一マシン・API 1コンテナ・専用DBではないローカル環境で、他の処理やDocker状態の影響も受ける。専用ジョブキューへの移行は行わないと確定したため（上記参照）、厳密な測定・スイープ能力の追加検証は行わない。測定後は `cleanup_perf.py --yes` を実行し、性能ユーザー1001件・作成レシピ4件・未処理outbox 0件を確認した。

#### 短時間スモーク（#260、2026-09-21）

学習用の最小確認として、ローカル開発環境で `fanout-strict.js` を10秒間・固定到着率1 req/s・
フォロワー10人で実行した。k6のsummary JSONは保存せず、アクセストークンやセッション情報を含まない集計値だけを記録する。

| 項目 | 結果 |
| ---- | ---- |
| 実行条件 | k6 v2.1.0 / Windows開発機 / ローカルAPI / 10秒 / 1 req/s |
| 計画件数 / 開始件数 / 完了件数 | 10 / 10 / 10 |
| 投稿API失敗 | 0件（HTTP 201） |
| `dropped_iterations` | 0件 |
| 投稿API応答時間 | avg 22.99ms / p95 40.56ms / max 57.55ms |
| outbox検証 | 10件中10件が処理済み |
| 通知検証 | 各レシピ10件、受信者集合一致 |
| 後始末 | 性能ユーザー11件・レシピ11件・未処理outbox 0件 |

この結果は短時間の実装確認であり、継続負荷の性能保証には使用しない。専用ジョブキューへの移行自体は、学習用アプリで実運用負荷が想定されないことを理由に「行わない」と確定した（[todo.md](todo.md) #18・#50）。厳密な測定は行わないため、この確定は性能上の必要性ではなく費用対効果の判断による。

| 項目 | 平均負荷（#146） | ストレス（#147） | スパイク（#148） |
| ---- | ---------------- | ---------------- | ---------------- |
| 測定日 / マシン | 2026-09-17 / Windows 11（開発機）。uvicorn 単一プロセス ＋ ローカル Docker（PostgreSQL 18・MinIO）。k6 v2.1.0 | 同左 | **2026-09-17（Issue #191 の対策後に再測定）**。ほかは同左 |
| データ量 | ユーザー 200・レシピ 3,000（`seed_perf` の既定） | 同左 | 同左 |
| feed p50 / p95 / p99 | 15.94ms / **48.70ms** / 67.65ms | 76.05ms / **158.08ms** / 195.78ms（全区間。下記の注記参照） | 回復区間: 30.59ms / **75.59ms** / 96.48ms |
| search p50 / p95 / p99 | 19.12ms / **48.07ms** / 66.78ms | 79.40ms / **161.19ms** / 199.15ms（同上） | 回復区間: 35.87ms / **76.06ms** / 92.65ms |
| detail p50 / p95 / p99 | 13.49ms / 48.27ms / 68.87ms | 72.95ms / 166.02ms / 202.67ms | 区間別の値なし（`name` × `phase` の組で集計していないため） |
| RPS（1 秒あたりのリクエスト数） | 58.34 req/s（7 分で 24,595 リクエスト・4,916 反復） | 119.07 req/s（16 分で 114,575 リクエスト・22,897 反復） | 63.48 req/s（4 分 25 秒で 16,793 リクエスト・3,429 反復・**中断 85 件**） |
| 失敗率 / 5xx 件数 | 0.00%（0 / 24,595）。check は 100.00%（29,511 / 29,511） | 0.00%（0 / 114,575）・**5xx 0 件**。check は 100.00%（137,472 / 137,472） | 1.17%（197 / 16,793）。内訳は**すべて 503（`shed_requests` 197 件）で、500 は 0 件**。check は 98.98%（19,858 / 20,062。feed ✗174・detail ✗16・search ✗14） |
| 最初に詰まった箇所 | — | **詰まりは観測されなかった**（5xx 0 件・失敗 0 件・中断された反復 0 件）。最大値のみ 639ms まで伸びた | 急増直後の **DB 接続プール**（`{phase:spike}` の p95 5.10 秒・p99 10.17 秒・最大 15.03 秒）。待ち上限（5 秒）を超えた分は 503 で切り捨てている |
| 回復までの時間 | — | — | **2 分の回復区間では平常域に戻っていた**（feed p95 75.6ms・search p95 76.1ms）。回復区間の失敗は 0 件 |
| 判定 | **合格**（閾値 4 つすべて。feed / search の p95 < 300ms） | **合格**（閾値 5 つすべて。p95 < 600ms・失敗率 < 1%・5xx 0 件） | **合格**（閾値 3 つすべて）。急増中の失敗は**意図した 503 の切り捨て**に変わった（下記の注記） |

- **ストレスの値は 16 分の全区間をまとめたもの**で、30 VU 区間と 45 VU 区間に分けた値ではない。`stress.js` は `browse()` に段階のタグ（`phase`）を渡していないため、k6 の集計からは区間別に読み取れない。区間別が必要になったら `--out csv=<出力先>` で時刻付きの生データを出して切り分ける（`flow.js` は `extraTags` を受け取れるようになっているので、タグを渡す実装にする手もある）。
- 平常（15 VU）から **3 倍の 45 VU まで上げても p95 は 48ms → 160ms（約 3.3 倍）**に収まり、緩やかな劣化で済んだ。600ms の許容に対しても余裕がある。
- **ストレスは Issue #191 の対策後に再測定したが、退行は無かった**（上の表の列は #147 の初回測定のまま）。閾値 5 つすべて合格・失敗率 0.00%（0 / 109,080）・`server_errors` 0 件、そして **`shed_requests` も 0 件**。つまり **45 VU（平常の 3 倍）を 5 分保っても 503 は 1 件も出ない**ので、プールの 20 接続は平常時の負荷に対して不足していない。503 が出るのは瞬間的な急増（スパイク）のときだけ、と切り分けられた。再測定の値は feed p95 193.08ms / search p95 198.01ms / 113.19 req/s（初回は 158.08ms / 161.19ms / 119.07 req/s）で、差は測定ごとのばらつきの範囲。
- **スパイクは閾値を満たしたが、急増中は壊れた**。10 秒で 15 → 100 VU（約 670%）に上げると、**5xx が 50 件**・check の失敗が 95 件・**中断された反復が 95 件**発生し、`{phase:spike}` の p99 は 59.94 秒（最大 60 秒 ＝ k6 のタイムアウト上限）まで伸びた。ストレス（45 VU を 5 分保つ）では 5xx が 1 件も出なかったので、**緩やかな増加には耐えるが、瞬間的な急増では捌けずに失敗する**という違いがはっきり出た。
  - 閾値が「全体の失敗率 < 5%」と「**回復区間**の p95 < 300ms」なので、急増中の失敗は判定に含まれない。合否だけを見ると見落とす。
  - 一方で**プロセスは落ちず、2 分で平常域まで自力回復した**（実行後の `GET /healthz`・`/healthz/db` も 200）。「壊れても復帰する」ことは確認できた。
  - **原因を特定した（Issue #189）**: **DB 接続プールの枯渇**。バックエンドのログを採りながら再実行したところ、`unhandled exception` が 129 件記録され、その例外は**1 種類だけ**だった。

    ```text
    QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00
    ```

    `backend/app/db.py` の `create_engine` は `pool_size` / `max_overflow` / `pool_timeout` を指定しておらず、SQLAlchemy の既定（**同時 5 ＋ 予備 10 ＝ 15 接続・待ち上限 30 秒**）のまま。100 VU が 15 本の接続を奪い合い、30 秒待って例外になっていた。**当初「uvicorn が単一プロセスだから」と見立てたが、これは外れ**。ワーカー数ではなく接続数が先に尽きていた。
  - **クライアントから見える失敗は一部でしかない**。同じ実行で、サーバーは **500 を 129 件**返したのに、k6 が受け取った 500 は **26 件**だった（ほかに k6 側のタイムアウト `status=0` が 62 件）。k6 が 60 秒で諦めた後もサーバーは処理を続けて失敗しており、**負荷試験の集計だけを見ると失敗を 5 分の 1 に過小評価する**。サーバーのログと突き合わせること。
  - 失敗は**すべて `spike` 区間**で起きた（`recovery` 区間は 4,595 件すべて 200）。回復の速さは前回の測定と同じ。
  - なお本番は API Gateway が手前にあり、**1 秒 50 リクエスト・瞬間 100** のスロットリングが効く（`infra/terraform/apigateway.tf`）。この測定は API Gateway を通さず uvicorn を直接叩いているため、**本番で同じ規模の急増が ECS に届くとは限らない**。

- **対策して再測定した（Issue #191）**。上の表のスパイク列は**対策後**の値。行ったのは 2 つだけで、どちらも数行の変更（課金は増えない。ECS のタスク数・CPU は据え置き）。

  1. **接続プールを明示した** — `pool_size=10` / `max_overflow=10`（合計 20 接続）/ `pool_timeout=5`（`app/config.py` で環境変数から変えられる）。
  2. **待たせずに 503 を返すようにした** — 待ち上限を超えたら `503` ＋ `Retry-After: 1`（`app/main.py` の `handle_db_pool_timeout`）。

  | | 対策前 | 対策後 |
  | --- | --- | --- |
  | サーバーの `unhandled exception`（＝ 500） | 129 件 | **0 件** |
  | `QueuePool ... timed out` | 129 件 | **0 件** |
  | 503（意図した切り捨て） | — | 216 件（k6 から見て 197 件） |
  | `{phase:spike}` の p99 / 最大 | 59.94 秒 / 60.00 秒（＝ k6 のタイムアウト上限） | **10.17 秒 / 15.03 秒** |
  | 捌けたリクエスト | 10,327 | **16,793** |
  | 回復区間の feed / search p95 | 78.1ms / 69.7ms | 75.6ms / 76.1ms（維持） |

  - **「捌けない要求が出る」こと自体は変わっていない**。100 VU 分の同時要求を 20 接続で処理しきれないのは同じで、変わったのは**その扱い**。60 秒待たせた末に 500 を返す（クライアントから見れば「返ってこない」）状態から、**5 秒で 503 を返して手放す**状態になった。結果として、同じ 4 分 25 秒で捌けたリクエストが 1.6 倍に増えている。
  - **503 はバグの 5xx と分けて数える**。`lib/flow.js` の `server_errors` は 500 以上のうち **503 を除いた**件数、`shed_requests` が 503 の件数。分けないと、対策が効いて 500 が 503 に変わったとたんに `server_errors: ["count==0"]`（ストレスの閾値）が落ち、改善が失敗に見える。
  - **サーバーとクライアントの食い違いは小さくなったが、まだある**（503 が サーバー 216 件 / k6 197 件）。突き合わせは今後も必要。
  - 監視（`infra/terraform/monitoring.tf`）では、503 もアクセスログ経由で 5xx として数えられる（持続する 503 はサービス低下なので通知してよい）。一方 `unhandled exception` のフィルタは**バグによる 500 だけ**を数えるので、この 2 つの差が「壊れている」と「混んでいる」の区別になる。

- 全体の応答時間は avg 21.11ms / med 15.96ms / p(95) 48.44ms / p(99) 67.87ms / max 128.84ms。**300ms の目安に対して 6 倍以上の余裕**がある。
- この測定には **Issue #185 で追加された署名付き URL の生成**が含まれる（レシピ 3,000 件すべてに `private/` のサムネイルキーがあるため、一覧 1 件ごとに HMAC を計算する）。それでも閾値に影響は無かった。
- ただし**本番は 0.25 vCPU / 0.5GB の Fargate**で、この開発機とは条件が違う。ここの数値は**変更前後の比較**に使うものとし、本番の応答時間の保証とはしない。

### SQL 実行計画の確認（Issue #193、2026-09-19）

ローカル PostgreSQL 18 に性能 seed（200 ユーザー / 3,000 レシピ / 9,000 材料）を投入し、`python -m scripts.explain_perf` で `EXPLAIN (ANALYZE, BUFFERS)` を実行した。スクリプトは development / test のローカル接続先だけを許可し、読み取り専用の `EXPLAIN` だけを実行する。

| 対象 | 実行時間 | 結果 |
| --- | ---: | --- |
| フィード | 0.076ms | `ix_recipes_is_public_created_at` の Index Scan を使用 |
| 検索 | 1.926ms | レシピは同インデックス、材料の部分一致は Seq Scan（9,023 行） |
| 詳細 | 0.012〜0.018ms | レシピ主キー、材料グループ・材料・手順の各 recipe_id インデックスを使用 |

- 材料検索は `ILIKE '%語%'` の部分一致なので通常のB-treeでは索引を使えないが、現データ量で2ms未満かつk6の検索p95基準を満たしているため、pg_trgmなどの追加インデックスは導入しない。
- 一覧の投稿者・お気に入り状態はページ単位でまとめて取得しており、結果件数に比例してSQL本数が増えるN+1は確認されなかった。データ量やp95が悪化した場合は、検索用インデックスを別Issueで検討する。

閾値を超えた場合は、1 リクエストあたりの SQL の数（N+1 が起きていないか）を調べて原因をここに書き、修正は別の Issue にする。
