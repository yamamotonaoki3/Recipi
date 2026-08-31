# Recipi — レシピ共有アプリ

## プロジェクト概要

手軽にレシピを登録・共有・検索できるアプリ。モバイルファーストで Android / iOS / デスクトップ（Windows・macOS）に対応。フォロー / お気に入り / 感想 / 通知など軽いソーシャル機能も持つ。バックエンドとフロントエンドを持つ複数レイヤー構成。

現在は要件定義フェーズ。要件定義書は機能別に分割され [docs/requirements/](docs/requirements/)（索引: [docs/requirements/README.md](docs/requirements/README.md)）。全機能版で、MVP の線引きは未確定（[docs/requirements/roadmap.md](docs/requirements/roadmap.md) をもとに別途決定）。

## 技術スタック

- **フロントエンド**: Kotlin Multiplatform + Compose Multiplatform（**Android / iOS / Desktop** を単一コードベース）、Ktor Client、kotlinx.serialization。ブラウザ（Web）版は当面対象外
- **バックエンド**: Python 3.14.7 + FastAPI（Uvicorn）、SQLModel（SQLAlchemy 2.0）、Alembic、psycopg 3、Pydantic v2、Argon2id（argon2-cffi）、JWT 認証（ライブラリは PyJWT / Authlib から選定、アクセス＋リフレッシュトークン / ローテーション）。パッケージ管理は venv + pip + requirements.txt（従来方式で学習、後で uv と比較）
- **DB**: PostgreSQL
- **画像保存**: S3 互換クラウドストレージ（ローカルは MinIO）
- **型共有**: FastAPI が出力する OpenAPI 3.1 → OpenAPI Generator で Kotlin クライアント / DTO を自動生成し `shared` に取り込む（コンパイル時共有はしない）
- **インフラ**: ローカルは Docker Compose（api + postgres + minio）。本番デプロイ先は未定
- **リポジトリ構成**: モノレポ。`backend/` は独立した Python プロジェクト（Gradle 非登録）、フロントは Gradle（`shared` / `composeApp` / `iosApp` / `desktopApp`）
- バージョンは実装着手前に `resolve-tech-stack` で確定する（バックエンドの Python 構成は確定済み）

## 学習方針

FastAPI / SQLModel / Python は未経験（Compose Multiplatform も）。Python を選んだ主目的は**今後アプリ内に AI 認識機能を取り入れる**こと。`learning-handover` で学習用引き渡し資料を作成するが、**学習完了を待たずに本実装を進める**（引き渡し資料は後日学習用）。

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
5. ユーザーが動作確認する（← ここで一度止まる。詳細は下記「Issue駆動…」章の停止条件に従う）
6. コミット → git push origin <ブランチ名>
7. GitHub で PR を作成する
8. Codex CLI でコードレビューを実行し、指摘があれば Codex 自身に修正させる（次項）。指摘ゼロまで繰り返す
9. セルフレビュー → マージ → ブランチ削除
```

### Codex CLI によるレビュー・修正フロー

このマシンには Codex CLI（ログイン済み）が導入されている。`codex review --base main` でブランチ差分を、`codex review --uncommitted` でコミット前の変更をレビューできる。Claude のセルフレビューに加え、別モデルの第二の視点として毎回活用する（恒久ルール）。

1. `codex review --uncommitted`（または `--base main`）でレビューを実行する。
2. 指摘があれば、指摘内容と対象ファイルを踏まえた修正指示を添えて `codex exec "<修正指示>"` を実行し、**Codex 自身にコードを修正させる**。Claude が直接修正するのは、Codex の応答が得られない等の代替手段とする。
3. Codex の修正後、Claude が動作確認（手順4）で検証する。
4. 指摘ゼロになるまで `codex review` の再実行 → `codex exec` による修正を繰り返す。

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

1. バックエンドとフロントエンドの両方を持つため、**同じ機能でもバックエンドとフロントエンドを別Issueにする**。フロントエンドのIssueは、対応するバックエンドのPRがマージされ動作確認が済むまで着手しない。
2. 1 Issueは「それ単体でレビュー・マージ可能な最小単位」にする。ロードマップ上で互いに依存しないタスクはまとめてよいが、依存関係のあるタスクを1つのIssueに詰め込まない。
3. Issue本文には次を含める：**対象領域**（backend/frontend/docs/infra等）・**参照すべきドキュメント**・**受け入れ基準**・**依存するIssue番号**。

## 次のIssueへの自動着手条件

以下をすべて満たすとき、ユーザーへの確認を挟まず次のIssueに着手してよい。

- 直前のIssueのPRがマージ済みである
- 直前のIssueの受け入れ基準（動作確認項目）を満たしている
- 次のIssueが依存する全てのIssueが完了している

## 必ず立ち止まる条件

- このプロジェクトのワークフロールールが「ユーザーによる動作確認」を要求している工程に到達したとき
- ドキュメントと実装の間に矛盾を見つけたとき（どちらを正とすべきかユーザーの判断が要る）
- このプロジェクトの設計原則（依存パッケージの追加制限など）に抵触しうる変更が必要になったとき
- ロードマップ等に「要調査」「未検証」と明記された項目に着手するとき

---

> このセクションは `apply-issue-workflow` スキルによって、このプロジェクトの CLAUDE.md に導入されました。
