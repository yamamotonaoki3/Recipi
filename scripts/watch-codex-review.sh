#!/usr/bin/env bash
# codex review / codex exec の進捗を 1 行ずつ標準出力に流す（Claude Code の Monitor 用）。
#
# ## なぜ必要か
# codex は完了まで十数分かかるうえ、失敗しても静かに終わることがある
# （例: バックグラウンド実行で stdin が null になり、プロンプトが渡らないまま
# 終了コード 0 で終わる。docs/lessons-learned.md 2026-09-08 参照）。
# 出力ファイルを眺めているだけでは「動いていない」と「時間がかかっている」を
# 区別できないため、進捗・停滞・結果を能動的に通知する。
#
# ## 設計上いちばん重要な点: ログ本文で判定しない
# このログには **codex が読んだリポジトリのファイル内容がそのまま流れ込む**。
# 実際、このスクリプト自身がレビュー対象（未コミット差分）に入っていたため、
# ここに書いた検出パターンを codex が読み上げてログに出力し、
# **監視が自分のパターン定義に反応して「完了」「失敗」を誤検知した**。
# そこで:
#   - 完了判定は呼び出し側から渡された **レビュー実行プロセスの PID の生死** で行う
#     （ログ本文やプロセス名を見ない）
#   - 結果の要約は、プロセス終了後に **ログ末尾だけ** を見る
#     （codex の結論は必ず最後に出るので、途中で引用されたファイル内容は入らない）
#
# npm 版の codex は codex.ps1 / codex.cmd が node.exe を起動するため、
# プロセス名で探すと実行中でも見失う。呼び出し側で `$!` を PID として渡す。
# 使い方: watch-codex-review.sh <出力ファイル> <レビューPID> [ハートビート秒]
set -uo pipefail

LOG="${1:?出力ファイルを指定してください}"
REVIEW_PID="${2:?レビュー実行プロセスの PID を指定してください}"
HEARTBEAT="${3:-45}"

started=$(date +%s)
last_size=0
last_beat=0
last_exec=""

codex_running() {
  # kill -0 はシグナルを送らず、指定 PID が生きているかだけを確認する。
  # npm ラッパーの実体が node.exe でも、プロセス名に依存せず監視できる。
  kill -0 "$REVIEW_PID" 2>/dev/null
}

while true; do
  now=$(date +%s)
  elapsed=$(( now - started ))

  if [ ! -f "$LOG" ]; then
    echo "[${elapsed}s] 出力ファイルがまだありません: $LOG"
    sleep 5
    continue
  fi

  size=$(wc -c < "$LOG" | tr -d ' ')

  # --- 終了検出（プロセスが消えたら結果を要約する） ---
  if ! codex_running; then
    sleep 2   # 最後の書き込みを取りこぼさない
    size=$(wc -c < "$LOG" | tr -d ' ')

    if [ "$size" -lt 500 ]; then
      echo "[${elapsed}s] **空振り**: 出力が ${size} バイトしかありません。"
      echo "    プロンプトが渡っていない可能性があります（stdin を閉じて再実行してください）。"
      exit 1
    fi

    findings=$(tail -n 120 "$LOG" | grep -aE '^- \[P[0-9]\]' | cut -c1-150)
    if [ -n "$findings" ]; then
      echo "[${elapsed}s] レビュー完了（指摘あり）:"
      echo "$findings" | sed 's/^/    /'
    else
      echo "[${elapsed}s] レビュー完了（${size} バイト）。末尾の結論:"
      tail -n 6 "$LOG" | grep -av '^\s*$' | cut -c1-150 | sed 's/^/    /'
    fi
    exit 0
  fi

  # --- 進捗: codex が今どのコマンドを実行しているか ---
  cur_exec=$(grep -a '^exec$' -A 1 "$LOG" | grep -av '^exec$' | grep -av '^--$' | tail -1 | cut -c1-110)
  if [ -n "$cur_exec" ] && [ "$cur_exec" != "$last_exec" ]; then
    echo "[${elapsed}s] 実行中: ${cur_exec}"
    last_exec="$cur_exec"
    last_beat=$now
  fi

  # --- 停滞・生存確認 ---
  if [ $(( now - last_beat )) -ge "$HEARTBEAT" ]; then
    if [ "$size" -eq "$last_size" ]; then
      echo "[${elapsed}s] 出力が ${HEARTBEAT}s 増えていません（${size} バイトのまま）"
    else
      echo "[${elapsed}s] 進行中（${size} バイト）"
    fi
    last_size=$size
    last_beat=$now
  fi

  sleep 5
done
