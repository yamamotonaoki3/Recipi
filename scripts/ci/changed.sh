#!/usr/bin/env bash
# PR の変更ファイルを見て、このワークフローの本体ジョブを走らせるかを決める（Issue #87）。
#
# 使い方: bash scripts/ci/changed.sh '<対象パスの正規表現>'
#   結果は $GITHUB_OUTPUT に `run=true` / `run=false` で書く。
#
# - pull_request 以外（push / workflow_dispatch）は常に run=true。
# - ワークフロー自身（.github/workflows/）とこのスクリプト（scripts/ci/）の変更でも
#   run=true（判定の仕組みを直した PR で全部が素通りしないように）。
# - 変更ファイルが取れないときは失敗で終わる（素通り＝成功にしない）。
#   ワークフロー側は、この判定ジョブが失敗したら本体を全部走らせる。
set -euo pipefail

pattern="${1:?対象パスの正規表現を渡してください}"
always='^(\.github/workflows/|scripts/ci/)'
out="${GITHUB_OUTPUT:-/dev/stdout}"

if [ "${EVENT_NAME:-pull_request}" != "pull_request" ]; then
  echo "run=true" >> "$out"
  echo "イベントが ${EVENT_NAME} なので常に実行する"
  exit 0
fi

# pull_request の checkout は「PR を main に取り込んだ仮のマージコミット」になる。
# その 1 つ目の親が取り込み先（main）なので、差分が PR の変更そのものになる。
# （checkout は fetch-depth: 2 で親まで取っておく）
if ! git rev-parse --verify --quiet HEAD^2 > /dev/null; then
  echo "::error::HEAD がマージコミットではないため、変更ファイルを判定できません" >&2
  exit 1
fi
files="$(git diff --name-only HEAD^1 HEAD)"

echo "変更ファイル:"
echo "$files" | sed 's/^/  /'

if echo "$files" | grep -Eq -- "$always|$pattern"; then
  echo "run=true" >> "$out"
  echo "対象の変更があるので実行する"
else
  echo "run=false" >> "$out"
  echo "対象の変更が無いので、本体のジョブは飛ばす（必須チェックは成功扱い）"
fi
