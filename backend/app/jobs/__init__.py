"""定期実行する管理コマンド（processing-model.md §8）。

`python -m app.jobs.<名前>` の形で 1 回実行する作りにしてある。
cron / コンテナスケジューラからの定期起動（何分おきに動かすか）・多重起動防止・
監視は、本番のデプロイ先が決まってから別の Issue で整える（Issue #72 の範囲外）。
ここでは「コマンドとして正しく動く」ところまで。

- `gc_uploads`      : 参照されなかった一時アップロードを回収する
- `storage_deletion`: 削除キューのオブジェクトを実際に消す
- `recount_counts` : カウント列を実数から数え直して補正する（4 列）
- `notification_sweep`     : 配り損ねた新着レシピ通知を配り直す（Issue #70）
- `cleanup_refresh_tokens` : 期限切れから日数がたったリフレッシュトークンを消す（Issue #72）
- `cleanup_notifications`  : 古い既読通知と処理済み outbox を消す（Issue #72）
- `trim_recipe_views`      : 閲覧履歴を 1 ユーザーあたりの上限件数まで削る（Issue #72）

**2 つに分けている理由**: GC は DB だけを触り、外部 I/O をしない。
ストレージの実削除は別ジョブに任せることで、S3 / MinIO が落ちていても
GC は進み、削除は後で再試行できる（processing-model.md §9）。
"""
