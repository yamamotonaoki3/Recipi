# Recipi — レシピ共有アプリ

## プロジェクト概要

手軽にレシピを登録・共有・検索できるアプリ。モバイルファーストで Android / iOS / デスクトップ（Windows・macOS）に対応。フォロー / お気に入り / 感想 / 通知など軽いソーシャル機能も持つ。バックエンドとフロントエンドを持つ複数レイヤー構成。

現在は要件定義フェーズ。要件定義書は機能別に分割され [docs/requirements/](docs/requirements/)（索引: [docs/requirements/README.md](docs/requirements/README.md)）。全機能版だが、**MVP（初回リリース）は Phase 4 まで**に確定（候補 B: 認証・レシピ CRUD・画像・ナビ・ホーム「全体」フィード・検索・閲覧履歴。[docs/requirements/roadmap.md](docs/requirements/roadmap.md) 「MVP ライン」）。Phase 5 以降は MVP 後、Phase 11（AI）は MVP 対象外。

## 技術スタック

- **フロントエンド**: **2 トラック**。どちらも 1 本の FastAPI を共通の OpenAPI 契約で叩く。
  - **(A) TypeScript（必須トラック）**: React Native + Expo（Expo Router / New Architecture）、NativeWind、openapi-typescript + openapi-fetch、TanStack Query。Desktop（Windows・macOS）は React Native Web ビルドを **Tauri 2** でパッケージ。カリキュラム指定
  - **(B) Kotlin Multiplatform（随時トラック・非ブロッキング）**: Compose Multiplatform（Android / iOS / Desktop）、Ktor Client、kotlinx.serialization。開発者の学習用
  - ブラウザ（Web）単体配信は当面対象外
- **バックエンド**: Python 3.14.7 + FastAPI（Uvicorn）、SQLModel（SQLAlchemy 2.0）、Alembic、psycopg 3、Pydantic v2、Argon2id（argon2-cffi）、JWT 認証（ライブラリは PyJWT / Authlib から選定、アクセス＋リフレッシュトークン / ローテーション）。パッケージ管理は venv + pip + requirements.txt（従来方式で学習、後で uv と比較）
- **DB**: PostgreSQL
- **画像保存**: S3 互換クラウドストレージ（ローカルは MinIO）
- **型共有**: FastAPI が出力する OpenAPI 3.1 →（Kotlin: OpenAPI Generator ／ TS: openapi-typescript）で各クライアントの型を自動生成（コンパイル時共有はしない）
- **インフラ**: ローカルは Docker Compose（api + postgres + minio。フロントは compose 外）。本番は **AWS**（Terraform で管理。API Gateway ＋ ECS Fargate ／ RDS PostgreSQL 18 ／ S3 ＋ CloudFront。[infra/terraform/README.md](infra/terraform/README.md)）
- **リポジトリ構成**: モノレポ。`backend/`（Python、Gradle 非登録）、`expoApp/`（TS、Gradle 非登録）、Kotlin フロントは Gradle（`shared` / `composeApp` / `iosApp` / `desktopApp`）
- バージョンは実装着手前に `resolve-tech-stack` で確定する（バックエンドの Python 構成・フロントの 2 トラック構成は確定済み）

## 学習方針

**TypeScript / React / Expo はカリキュラム指定の必須トラック**（期限あり）。**Kotlin Multiplatform / Compose は開発者が自分で試したい随時トラック**で、必須トラックの進捗をブロックしない。FastAPI / SQLModel / Python も未経験で、Python の主目的は**今後アプリ内に AI 認識機能を取り入れる**こと。`learning-handover` で学習用引き渡し資料を作成するが、**学習完了を待たずに本実装を進める**（引き渡し資料は後日学習用）。

## 開発ワークフロー（Issue → ブランチ → PR）

1. ロードマップ・WBS・要件定義書に基づき、機能を GitHub Issue に分割して起票する。
2. Issueごとにブランチを作成し、実装 → PR作成 → レビュー → マージ の流れで進める。
3. ユーザーからコミット指示があったら、コミット完了後すぐにプッシュまで自動実行する。

---

## 絶対に守るルール

1. **作業は必ず Issue から始める**
   - コード変更・機能追加・バグ修正・ドキュメント更新、いかなる作業も GitHub Issue を先に作成する。
   - Issue なしにブランチを切ってはいけない。
2. **`main` ブランチへの直接プッシュ禁止**
   - `git push origin main` は禁止。必ず作業ブランチから PR を作成し、マージで取り込む。
3. **PR はレビュー・動作確認後にマージする**
   - 自分でセルフレビューを行い、チェックリストを埋めてからマージする。
   - CI が通っていることを確認する。落ちている状態でマージしない。
4. **内部設定・周知不要なものは GitHub に上げない**
   - `.claude/`（スキル・エージェント・設定等、Claude Code の内部動作設定）は `.gitignore` で除外し、リポジトリにコミットしない。
   - 個人環境依存でチーム外への周知が不要な設定ファイルもコミット対象外とする。
5. **環境変数は開発 / テスト / 本番で分離し、切り替えられるようにする**
   - 用途別に `.env` ファイルを分ける:
     - `.env.development` … 開発環境（ローカルの Docker Compose）
     - `.env.test` … 自動テスト / 結合テスト。接続先は**ローカルまたはテスト専用環境に限定**し、本番・ステージング DB に接続しうる設定でテストを実行しない（グローバル CLAUDE.md「テストデータの標準要件」）。
     - `.env.production` … 本番。実ファイルはリポジトリに置かず、デプロイ先のシークレット管理機構で注入する。
   - 実値を持つ `.env*` は**すべて `.gitignore` 対象**。各環境に対応する `.env.development.example` / `.env.test.example` / `.env.production.example` を**プレースホルダのみ**でコミットする（`.gitignore` の `.env.*` 除外と `!.env.*.example` の例外を維持）。
   - 実行時は `APP_ENV`（`development` / `test` / `production`）で読み込むファイル・設定を切り替える。
   - 実値・現在有効な認証情報を、コミット対象ファイル・コミットメッセージ・PR / Issue 本文に書かない（グローバル CLAUDE.md「秘密情報の標準取り扱い要件」、[docs/requirements/architecture.md](docs/requirements/architecture.md) §秘密情報の扱い）。
6. **新しい技術選定が必要になったとき**
   - 要件定義書（[docs/requirements/](docs/requirements/)）に明記の無い技術要素の選定が必要になった場合は、`resolve-tech-stack` スキルに従う。Claude 単独で決めず、必ずユーザーに確認し、決定したらバージョンを明記して利用可否を検査する。

---

## ブランチ命名規則

```
<prefix>/#<issue番号>-<英語の概要>
```

| プレフィックス | 用途 |
|---|---|
| `feature` | 機能追加 |
| `fix` | 不具合修正 |
| `chore` | リファクタ・設定変更・依存更新 |
| `docs` | ドキュメントのみの変更 |

**例:** `feature/#1-add-recipe-entity` / `fix/#5-login-not-working` / `chore/#3-update-gradle-wrapper` / `docs/#2-add-api-spec`

---

## 作業フロー（毎回この順番で）

```
0. ドキュメントを必ず読む（プランを立てる前に必ず実施）
     - docs/requirements/README.md … 要件定義の索引
     - docs/requirements/roadmap.md … 該当 Phase の WBS と受け入れ基準
     - docs/requirements/features/<対象機能>.md … 対象機能の一次情報
     - docs/requirements/api.md / data-model.md / screens.md … API・型・画面を触る場合
     - docs/lessons-learned.md … 過去の Codex 指摘・手直しの記録。索引を確認し、関係する内容があれば対策を計画に盛り込む
     対象機能に関係する章を全て確認した上で実装プランを立てる。
1. GitHub で Issue を作成する
2. ブランチを切る: git checkout -b feature/#<番号>-<概要>
3. 実装する（roadmap の Phase 順序を守り、受け入れ基準を満たしてから次に進む）
4. 動作確認する（テストが全て通ること・そのIssueの受け入れ基準を満たすこと）
   - **E2E が今回の実装を実際に検証しているかを中身で確認する**（スイートが緑でも、既存シナリオだけなら今回の機能は未検証）。無ければ足す。足せないなら理由と代替の担保を報告する。詳細は下記「E2E が実装に対応しているかの確認」
5. ユーザーが動作確認する（← ここで一度止まる。詳細は下記「Issue駆動…」章の停止条件に従う）
6. コミット → git push origin <ブランチ名>
7. GitHub で PR を作成する
8. Codex CLI でコードレビューを実行し、指摘があれば Codex 自身に修正させる（次項）。指摘ゼロまで繰り返す
9. セルフレビュー → マージ → ブランチ削除
```

### E2E が実装に対応しているかの確認（恒久ルール）

**テストが「通った」ことと、そのテストが「今回の実装を検証している」ことは別**。E2E スイートが緑でも、それが既存シナリオだけなら、今回足した機能は 1 行も検証されていない。動作確認の工程では、毎回次を確認する。

1. **今回の変更を検証する E2E が実在するか**を、シナリオ名ではなく**中身**で確かめる（例: `grep` で新しい画面の testID・新しいエンドポイントのパスを探す）。
2. 無ければ**足す**。足せない事情があるなら、**その理由と、代わりに何が担保しているかを報告する**（黙って飛ばさない）。
3. 足せない典型は「backend 先行で画面がまだ無い」ケース。このときは **API 層の E2E**（Playwright の `request` フィクスチャで実際に動いている API を直接叩く）で代替する。参考: `expoApp/e2e/web/security-question-api.spec.ts`（Issue #240）。
   - backend の pytest（`TestClient`）とは**通る経路が違う**ので重複ではない。API 層の E2E だけが「ビルドしたコンテナに変更が入っているか」「実 DB にマイグレーションが当たっているか」「uvicorn とエラーハンドラを通した実際のステータスコード」を検証できる。
   - 網羅（境界値・競合・監査ログ）は backend のテストに任せ、API 層の E2E は**契約の要点だけ**に絞る。
4. **後続 Issue に責任を引き継ぐときは、Issue 本文に追記する**。「画面ができたら E2E を足す」を口頭で済ませると必ず落ちる。

#### Web E2E はコンソール監視付きの `test` を使う（Issue #247）

Web の spec は `@playwright/test` ではなく **`./console-guard` の `test` / `expect`** を import する。組み込みの `page` を差し替えてあり、error レベルのコンソール出力と未捕捉例外があるとテストが落ちる。

- `browser.newContext().newPage()` で自分で作ったページは自動では監視されない。**最初の `goto` の前に `consoleGuard.watch(page)`** を呼ぶ
- テストが意図して起こす異常系（誤ったパスワードの 401 など）は、**そのテストの中だけ** `consoleGuard.allow(...)` で URL とメッセージを絞って許可し、理由を書く。全体に効く許可にしない
- 本物の不具合をやむを得ず通すときは `KNOWN_ISSUES` に**追跡 Issue 番号と解除条件**を付けて入れる。無言で足さない
- **限界**: テスト終了後に届くエラーは拾えない（存在しないホストへの画像読み込みは約 2.7 秒後に届く。1〜2 秒で終わるテストでは素通りする）。**画像は `toBeVisible()` ではなく、実際に読み込めたか（`naturalWidth > 0`）で確かめる**

#### 品質チェックは必ずプロジェクト全体にかける

`ruff` や `mypy` を `app/` などサブディレクトリだけに限定して実行しない。**CI はプロジェクト全体（`backend/` なら `tests/` を含む）を検査する**ので、一部だけ通してもローカルで気づけない。

- backend: `ruff check .` / `ruff format --check .` / `mypy .` を **`backend/` 直下で `.` を対象に**実行する
- テストを書いた後にも必ずかけ直す（実装の後に一度通しただけでは、後から足したテストが検査されない）
- **`ruff format` は `# type: ignore` コメントを別の行へ動かすことがある**。整形の後に `mypy` を実行し、「Unused type: ignore」が出ていないか確かめる（Issue #241 で実際に CI が落ちた）

#### E2E の実行環境で必ず確認すること

「テストが落ちた」の大半は実装ではなく環境が原因になりうる。原因の切り分けにかかる時間を減らすため、実行前に次を確かめる。

1. **静的サーバーが指定ポートを本当に確保したか**。`npx serve -l 8081` は**ポートが埋まっていると黙って別のポートにフォールバックする**（終了コードも正常）。`curl` が 200 を返しても、応答しているのは別のサーバーかもしれない。必ず `serve` のログの `Accepting connections at ...` を読む。
2. **静的サーバーに `-s`（SPA フォールバック）を付けない**。`-s` は全ルートに `index.html` を返すため、ルートごとに事前描画した HTML と URL が食い違い、開くたびに `Minified React error #418`（ハイドレーション不一致）が出る（Issue #267 で原因を確定）。`npx serve dist -l 8081 -c ../e2e/serve.json`（`expoApp/e2e/serve.json` が動的ルートを対応する HTML へ振る）を使う。
3. **配信されている HTML が静的バンドルを指しているか**。`curl <URL>/login | grep 'src='` が `/_expo/static/js/web/entry-*.js` なら正しい。`node_modules/expo-router/entry.bundle?...dev=true` を指していたら、掴んでいるのは Expo 開発サーバーで、そのリクエストは永久に pending になり `load` が完了しない。
4. **Web ビルド時に `EXPO_PUBLIC_API_BASE_URL` を渡したか**（CI の `e2e.yml` は渡している）。渡し忘れると API の宛先が解決できない。
5. 実行後は **`cleanup_e2e.py` で残数 0 を確認**する。

#### レート制限のあるエンドポイントを E2E で叩くとき

E2E は**すべて同じ IP から走り、テストの合間に試行記録を消す仕組みが無い**（`backend/tests/conftest.py` の fixture は pytest 専用）。IP 単位の制限があるエンドポイントを各 spec で繰り返し呼ぶと、1 回の実行の途中で上限に達して 429 で落ちる。

**E2E での呼び出しは必要最小限に抑え、レート制限そのものの検証は backend のテストに任せる。** 先例: `expoApp/e2e/web/password-reset.spec.ts` の冒頭コメント、`security-question-api.spec.ts` の「レート制限に注意」。

### Codex CLI によるレビュー・修正フロー

このマシンには Codex CLI（ログイン済み）が導入されている。`codex review --base main` でブランチ差分を、`codex review --uncommitted` でコミット前の変更をレビューできる。Claude のセルフレビューに加え、別モデルの第二の視点として毎回活用する（恒久ルール）。

1. `codex review --uncommitted`（または `--base main`）でレビューを実行する。**出力はファイルにリダイレクトし、必ず進捗監視を付ける**（次項「実行時の必須事項」）。
2. 指摘があれば、指摘内容と対象ファイルを踏まえた修正指示を添えて `codex exec "<修正指示>"` を実行し、**Codex 自身にコードを修正させる**。Claude が直接修正するのは、Codex の応答が得られない等の代替手段とする。
3. Codex の修正後、Claude が動作確認（手順4）で検証する。
4. 指摘ゼロになるまで `codex review` の再実行 → `codex exec` による修正を繰り返す。

#### 実行時の必須事項（進捗を必ず見えるようにする）

`codex review` / `codex exec` は完了まで十数分かかるうえ、**失敗しても静かに終わることがある**（バックグラウンド実行で stdin が null になり、プロンプトが渡らないまま終了コード 0 で終わる等）。「動いていない」と「時間がかかっている」を区別できないまま待つことがないよう、次を必ず守る。

1. **標準入力を明示的に閉じる**: `codex review --uncommitted < /dev/null > <ログ> 2>&1`
2. **進捗監視を必ず併走させる**: codex の PID を渡して `scripts/watch-codex-review.sh <ログ> <レビューPID>` を Monitor で起動する。実行中のコマンド・検出した指摘・停滞・失敗が随時通知される。
3. **出力が極端に小さいときは成功と見なさない**。`Reading additional input from stdin` の 1 行だけ（数十バイト）で終わっていたら空振り。必ず `git diff` で実際の変更を確認する。

```bash
codex review --uncommitted < /dev/null > /tmp/codex-review.txt 2>&1 &
review_pid=$!
# 別途 Monitor で、review_pid を渡す:
bash scripts/watch-codex-review.sh /tmp/codex-review.txt "$review_pid"
```

**監視スクリプトの誤検知に注意**: codex が実行した個々のコマンドの失敗（Windows で `rg .env*` が `os error 123` になる等）は、codex 自身がやり方を変えて続行するため**失敗として扱わない**。判定に使うのは codex 本体が続行不能になった兆候だけにする。

**レビューで Issue が肥大化したときは止まる（恒久ルール）**: 計画レビューを重ねた結果、その Issue が「単独でレビュー・マージできる最小単位」を明らかに超えたと判断したら、**レビューを続けずにユーザーへ相談する**。指摘が技術的に正しくても、それを全部満たすと数日規模になる場合がある。判断の目安:

- 指摘を満たすために**新しい基盤**（専用 DB・専用ハーネス・別スクリプトのテスト一式）が必要になった
- 当初 1 Issue のつもりだったものが、**明らかに複数の独立した成果物**に分かれている
- 厳密さを追うコストと、このプロジェクトでの価値が釣り合っていない（例: 実ユーザーのいない学習用アプリで統計的に厳密なベンチマークを組む）

相談するときは「厳密にやる / 範囲を縮める / 後回しにする」の選択肢と、**縮めた場合に何を名乗らないことになるか**（例: p95 や移行閾値を名乗らない）を示す。**雑な測定で厳密な結論を名乗るのが一番まずい**ので、縮めるなら限界を成果物に明記する。

参考: Issue #248（fan-out 性能測定）で、計画レビュー 2 回で major 14 件が出て、厳密にやるなら専用 DB・サンプル数の事前決定・測定スクリプト自身のテスト・seed の全項目回帰が必要になった事例。

**レビュー回数の上限（恒久ルール）**: `codex review` は**最大5回**まで繰り返す。5回を超えても指摘が続く場合は、それ以上のレビューを打ち切り、残った指摘を一覧化してユーザーに提示し、判断を仰ぐ。ただし以下は上限を適用せず、指摘ゼロになるまで繰り返す:
- **重大なバグ**（データ破損・認証バイパス・本番相当の情報漏えいなど、実際に事故につながる不具合）の指摘
- 既に合意済みの設計判断（ADR・`resolve-tech-stack` での決定事項など）の再提起は、上限回数に数えず、`codex exec` でその旨（既知のトレードオフである理由・参照先）を伝えて確認を取るだけに留め、コードは変更しない（本ファイル「新しい技術選定が必要になったとき」のルール参照）。

**副次的な後始末はベストエフォートにする（恒久ルール）**: 認証・セッション破棄などの「メイン処理」に付随する後始末（例: セキュアストレージの削除、キャッシュの掃除等）は、失敗してもメイン処理の結果（エラー応答・セッション破棄そのもの）を変えてはならない。後始末は個別に `try/catch` で囲み、失敗を握りつぶす（ログに残す程度に留め、メイン処理の例外として伝播させない）。

---

## コミットメッセージ規則

```
<種別>: <変更内容の要約>（日本語可）

例:
feat: レシピ CRUD の登録エンドポイントを実装
fix: リフレッシュトークン検証時の失効判定を修正
chore: docker-compose に minio を追加
docs: 認証機能の要件定義を追加
```

---

## 学び・手直しの記録

Codex レビューで採用された指摘や、実装中に発生した手直しを [docs/lessons-learned.md](docs/lessons-learned.md) に記録する。

- 記録のタイミング・基準・形式は `lessons-learned` スキルに従う。
- ユーザーが明示的に「覚えておいて」と言った場合は、除外条件（秘密情報・一時的指示・既存ルールと矛盾する内容等）に触れない限り即記録する。
- 記録は必ずマージ前に行い、そのIssueの PR に含める。

---

# Issue駆動・複数Issue自動連続実行ルール

このプロジェクトでは、ロードマップ・WBS等に基づき、機能を複数の GitHub Issue に分割して連続的に実装していく。個別のドキュメントがこれと異なる具体的なルールを定めている場合は、そちらを優先する。

## Issueの分割方針

1. **同じ機能でも backend / frontend-ts / frontend-kotlin の 3 系統に Issue を分ける**。
   - `frontend-ts`（TypeScript / Expo、**必須トラック**）の Issue は、対応する backend の PR がマージされ動作確認が済むまで着手しない。
   - `frontend-kotlin`（KMP / Compose、**随時トラック**）は非ブロッキング。着手は任意で、必須トラックの進捗をブロックしない。
2. 1 Issueは「それ単体でレビュー・マージ可能な最小単位」にする。ロードマップ上で互いに依存しないタスクはまとめてよいが、依存関係のあるタスクを1つのIssueに詰め込まない。
3. Issue本文には次を含める：**対象領域**（backend/frontend/docs/infra等）・**参照すべきドキュメント**・**受け入れ基準**・**依存するIssue番号**。

## 次のIssueへの自動着手条件

以下をすべて満たすとき、ユーザーへの確認を挟まず次のIssueに着手してよい。

- 直前のIssueのPRがマージ済みである
- 直前のIssueの受け入れ基準（動作確認項目）を満たしている
- 次のIssueが依存する全てのIssueが完了している

**自動連続実行の完了判定は backend + frontend-ts で行う。** `frontend-kotlin`（随時トラック）は完了条件に含めず、その未着手・未完了を理由に次に進むのを止めない。

## 必ず立ち止まる条件

- このプロジェクトのワークフロールールが「ユーザーによる動作確認」を要求している工程に到達したとき
- ドキュメントと実装の間に矛盾を見つけたとき（どちらを正とすべきかユーザーの判断が要る）
- このプロジェクトの設計原則（依存パッケージの追加制限など）に抵触しうる変更が必要になったとき
- ロードマップ等に「要調査」「未検証」と明記された項目に着手するとき

---

> このセクションは `apply-issue-workflow` スキルによって、このプロジェクトの CLAUDE.md に導入されました。
