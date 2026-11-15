# ドキュメントと実装の整合性確認（2026-11-15）

対象Issue: [#367](https://github.com/yamamotonaoki3/Recipi/issues/367)。照合元は `main` のコミット `386dad030cfea7198bc510e8f8491b630551218a`。修正はドキュメントのみで、機能・依存・DBスキーマ・運用設定は変更していない。

## 確認方法と範囲

追跡対象のMarkdown 59ファイルを一覧化した。READMEと現行仕様・画面・設定・運用の説明を、以下の一次情報と照合した。過去の学び・セキュリティ検証記録・プロトタイプは作成時点の記録として扱い、過去の結果を現在の結果へ書き換えていない。`lessons-learned.md` は実際に切れていた参照リンクだけを修正した。

| 資料 | 主な照合先 | 修正した内容 |
| --- | --- | --- |
| root / backend / expoApp README | `backend/app/main.py`、`expoApp/src/`、`package.json`、`jest.config.js`、Compose | デモの前提・固定AI応答、実装済み機能、コード配置、認証・再開、カバレッジ下限、MSWの実行環境、本番経路 |
| architecture / tech-stack / environment / roadmap | `backend/app/config.py`、`app/ai.py`、Compose、MinIO Dockerfile、Terraform、契約CI | 実在するパス、未着手Kotlinと現行実装の区別、Ollamaの接続先と優先順位、MinIOビルド方式、設定カタログ、AIの時間枠管理 |
| API / データモデル / 機能仕様 | OpenAPI、schemas、models、services、auth transport | 再開・クライアント設定・ヘルスチェックAPI、Cookie方式、画像キー・単位表示位置、保持フラグ・索引、upload管理行 |
| 画面・非機能・処理方式 | `expoApp/src/app/`・`screens/`・`features/`、`services/account.py` | 退会導線と論理削除、保持/削除対象、常にホームへ進むログイン、アプリ情報・設定の索引、機能仕様と画面仕様の優先関係 |
| testing / Terraform README | `.github/workflows/`、`scheduler.tf`、`backend/app/jobs/` | GitHub Release配布と手動artifactの区別、macOSビルドの実行範囲、9本の定期ジョブ・270回/日の起動回数 |

API一覧の機械照合では、OpenAPIのメソッド・パス47件を正規化して文書と比較した。設定一覧は `Settings` の47フィールドとの記載一致を確認した。これは各フィールドの全制約や全APIの実行結果の保証ではなく、一覧の抜け・余剰の確認である。

## 仕様を消さずに残した差分

| 元の要件 | 現行コードで確認できた状態 | 追跡先 |
| --- | --- | --- |
| フォロー・フォロワー一覧のモバイル左右スワイプ切替 | `ConnectionsScreen.tsx` はタブ押下で切替。スワイプ処理は見当たらない | [#368](https://github.com/yamamotonaoki3/Recipi/issues/368) |
| 感想通知からレシピ詳細の該当感想へ移動 | `NotificationsScreen.tsx` はrecipeIdだけで詳細へ遷移し、commentIdを渡さない | [#369](https://github.com/yamamotonaoki3/Recipi/issues/369) |

両方とも要件は維持し、現状との差分を該当ドキュメントへ明記した。機能を追加するか仕様を変更するかは、各Issueで動作確認とユーザー判断を行う。今回の文書修正で勝手に機能変更はしていない。

## 検証

- ローカルMarkdownリンクの参照先の存在を検査した。コード例内のリンク風文字列や外部URLは対象外。外部サイトの内容・リンク先アンカーの網羅検査は行っていない。
- OpenAPI 47操作の一覧と、環境設定47フィールドの記載漏れ・余剰を検査した。
- `git diff --check` と、変更した `expoApp/README.md` の既存Prettierによる整形・検査を行った。
- `codex review --uncommitted` を標準入力を閉じ、ログ保存・進捗監視付きで1回実行した。終了コード0、約343KBのログと「actionable regressionsなし」の結果を確認した。レビューツールは既存の未追跡計画書も読んだが、そのファイルは今回の修正に含めていない。追加した説明はセルフレビューでもソースと再照合した。
- 関連E2Eはシナリオ名だけでなく中身を確認した。`social-flow.spec.ts` は退会後も他ユーザーのお気に入りに投稿が残ることと再開を検証し、`profile-connections.spec.ts` はタブ押下とプロフィール反映を、`content-lifecycle.spec.ts` はレシピ削除・非公開化などを検証している。これらをスワイプ・該当感想への自動スクロールの担保とは扱わない。

実装を変更していないため新規E2Eは追加せず、今回E2E・pytest・Jest・ビルドは再実行していない。既存ドキュメントの未チェック受け入れ基準を、コードが存在するだけで検証済みへ変更していない。本番接続・デプロイ・テストデータ削除は行っていない。

## 作業ツリー

開始前から存在した未追跡計画書 `docs/superpowers/plans/2026-10-24-issue-353-android-e2e-dependency-migration.md` は保持し、今回の変更に含めない。秘密情報・環境実値・撮影素材も変更対象外。Gitへの反映状況は対応するIssue・PRを参照する。
