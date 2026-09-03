# テスト / CI・CD 方針

> 実装（Phase 0〜）で満たすテストの方針。各機能の受け入れ基準は `features/*.md`、処理の設計は [processing-model.md](processing-model.md) を正とし、この文書は「どのレイヤーで・どの技法で・どう自動化して品質を担保するか」を定める。
>
> **ツールは 2026-09-03 に確定**（下表）。バージョンは各 Phase の scaffold 時に固定し、このマシンでの利用可否を検査する（フロントのバージョンを確定したのと同じ流れ。[tech-stack.md](tech-stack.md)）。

## 1. テストのレイヤー

| レイヤー | 目的 | backend（Python / FastAPI） | frontend-ts（Expo / React Native） |
| --- | --- | --- | --- |
| **品質チェック（静的解析）** | 実行しなくても分かる誤り・スタイル崩れを機械的に弾く | **ruff**（lint ＋ `format --check`）、**mypy**（型チェック） | **ESLint**（Expo 設定）、**Prettier `--check`**、**`tsc --noEmit`**（型チェック） |
| **単体テスト（unit）** | 関数・クラス・hook・コンポーネントを単体で検証。外部依存はモック | **pytest**。純粋関数（正規化・単位整形・カーソルのエンコード）、Pydantic モデルのバリデーション、サービス層のロジック（DB はモック / インメモリ） | **jest-expo ＋ @testing-library/react-native**。表示整形などの util、hooks、コンポーネント（API は MSW でモック） |
| **結合テスト（integration）** | 複数の部品を実際につないで検証。DB・ストレージは本物 | **pytest ＋ 実 PostgreSQL**（Alembic マイグレーションを適用したテスト DB）＋ **MinIO**。API を `httpx` ＋ `ASGITransport` で直接叩き、認証フロー・CRUD のトランザクション・カウント列・CASCADE を検証 | **MSW** で生成 API クライアントをモックし、画面 → API 呼び出し → 状態更新（TanStack Query のキャッシュ / 無効化）→ 再描画 の一連を検証 |
| **E2E テスト** | ユーザーがアプリを操作する流れを端から端まで検証 | — | **Maestro**（YAML でフロー記述）。`infra/docker-compose.yml` のフルスタック（api ＋ postgres ＋ minio）に対し、Phase ごとの主要フローを実行 |
| **契約テスト（contract）** | backend の API 契約とフロントの生成コードのズレを検知 | CI で FastAPI から `openapi.json` を再生成し、コミット済みと一致するか（`git diff --exit-code`） | CI で `openapi-typescript` を再実行し、生成物（`expoApp/src/api/schema.ts`）に差分が出たら失敗（[todo.md](todo.md) #42） |

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

- PR ごとに計測し、結果を PR にコメント表示する。
- **行カバレッジと分岐カバレッジの両方**でゲートする（`pytest-cov --cov-branch` / jest の `coverageThreshold.branches`）。下限を割ったら CI を失敗させる。
- **下限（開始 = Phase 1）**: backend 行 70% / 分岐 60%、frontend 行 60% / 分岐 50%。
- Phase ごとに引き上げ、**MVP 完成時の目標**: backend 行 85% / 分岐 75%、frontend 行 75% / 分岐 65%。
- 数値は実装しながら現実に合わせて調整してよい（下げる場合は PR にその理由を書く）。カバレッジは目安であって、**BB/WB の観点で必要なケースが書けているか**を優先する。

## 4. テストデータ規約

[non-functional.md](non-functional.md) 「テストデータ規約」＋ グローバル `~/.claude/CLAUDE.md` 「テストデータの標準要件」に従う（[environment.md](environment.md) にも再掲）。

- メールは `@example.com` / `@example.org` / `@example.net` のみ。
- ユーザー名は `testuser_%` / `e2euser_%` 接頭辞、本文に `[E2E_TEST]` 等のタグ。
- パスワードは `TestPass123!` のようなテスト専用固定値。
- 識別子ベースで一括削除する `cleanup`（SQL / スクリプト）を用意し、テスト後に残数 0 を確認する。
- **テストは本番・ステージング DB に接続しない**。接続先はローカル（Docker）または CI の使い捨て DB に限定し、接続文字列をテストコードから確認できるようにする。

## 5. CI（GitHub Actions）

`.github/workflows/` に配置する。

| ワークフロー | トリガー | 内容 |
| --- | --- | --- |
| `backend.yml` | `backend/**` を含む push / PR | ruff → mypy → pytest（単体）→ pytest（結合。`services: postgres` ＋ MinIO コンテナ、`.env.test` は CI で生成）→ カバレッジ集計・PR コメント |
| `frontend-ts.yml` | `expoApp/**` を含む push / PR | ESLint → Prettier `--check` → `tsc --noEmit` → jest（単体・結合、カバレッジ）→ `expo export`（Web）＋ `tauri build` スモーク |
| `contract.yml` | backend / `openapi.json` / 生成設定の変更 | `openapi.json` 再生成の diff チェック（Phase 0）＋ `schema.ts` 再生成の diff チェック（frontend 導入後） |
| `e2e.yml` | PR（Phase 1 以降）／ 手動 | docker-compose でフルスタック起動 → シード → Maestro フロー実行（Android エミュレータ ＋ Web） |

- **トリガー**: `pull_request`（→ `main`。マージの必須チェックにする）＋ feature ブランチへの `push`。
- **パスフィルタ**: `backend/**` の変更で frontend ジョブを回さない（逆も同様）。共通ファイル（`openapi.json` 等）は両方を回す。
- **ブランチ保護**: `main` への直接 push 禁止（既存ルール）＋ 上記チェックを必須にする（有効化は Phase 0 着手前にユーザーへ確認）。
- **ローカルでの再現**: `backend/` は `pytest` / `ruff check` / `mypy`、`expoApp/` は `npm test` / `npm run lint` / `npm run typecheck`。手順はルート `README.md`（Issue で作成）。Maestro CLI は各自インストール（JDK 25 導入済み。[todo.md](todo.md)）。

## 6. CD（継続的デリバリー）

- **本番デプロイ先が未定**（[todo.md](todo.md) #2、Phase 10 で確定）。それまで CD は **ビルド / パッケージ検証のみ**:
  - backend: Docker イメージの `build` が通ること。
  - frontend: `expo export`（Web ビルド）＋ `tauri build`（未署名デスクトップパッケージ）のスモーク。
- **実デプロイは行わない。** Phase 10 でデプロイ先を確定したら `deploy` ジョブを追加する。
- デモ用のデスクトップパッケージ（未署名 `.msi` / `.dmg`）は MVP 時点でも上記スモークの成果物として取り出せる（[roadmap.md](roadmap.md) 「MVP ライン」）。

## 7. ツール一覧（確定）

| 用途 | 採用 | 備考 |
| --- | --- | --- |
| backend lint / format | **ruff** | 2026 の Python 標準。`pyproject.toml` に設定 |
| backend 型チェック | **mypy** | strict 寄せの度合いは実装時に調整 |
| backend テスト | **pytest**（＋ `pytest-asyncio` / `pytest-cov` / `httpx`） | 結合は `ASGITransport` で FastAPI を直接叩く |
| backend 結合の DB / ストレージ | GitHub Actions `services:`（postgres）＋ MinIO コンテナ | `testcontainers` は使わない（ランナー標準の services で足りる） |
| frontend lint / format | **ESLint**（Expo 設定）＋ **Prettier** | |
| frontend 型チェック | **`tsc --noEmit`** | |
| frontend テスト | **jest-expo ＋ @testing-library/react-native** | Expo 標準。vitest は使わない |
| frontend API モック | **MSW**（Mock Service Worker） | 生成した API クライアントの下でネットワークをモック |
| E2E | **Maestro**（CLI・Apache 2.0 の無料 OSS） | モバイル（エミュレータ）＋ Web を 1 ツールで。ホスティング型クラウド（有料）は使わない |
| 契約 | `openapi-typescript`（フロント）／ FastAPI 標準出力（backend） | [tech-stack.md](tech-stack.md) 「型共有」 |

## 8. 未確定（各 Phase 着手時に `resolve-tech-stack` で確定）

- 各ツールのバージョン（Phase 0 の scaffold 時に固定）
- JWT ライブラリ（PyJWT 予定・[todo.md](todo.md) #41）、PostgreSQL メジャーバージョン（[todo.md](todo.md) #5）
- フロントの状態管理ライブラリ（Zustand / Jotai・[todo.md](todo.md) #7）
- E2E をどのプラットフォームまで CI で回すか（Android エミュレータ ＋ Web は必須。iOS シミュレータは macOS ランナーが要るため要検討）
- カバレッジの最終的な下限値
