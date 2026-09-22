#!/usr/bin/env bash
# README用デモGIFの元動画（record-demo.tsが生成した.webm）をGIFに変換する。
#
# 2パス方式（palettegen → paletteuse）でファイルサイズを抑えつつ画質を保つ。
# モバイルサイズの録画なので出力幅400px・10fpsに絞り、README埋め込みに
# 適したファイルサイズに収める。
#
# 使い方: scripts/demo/webm-to-gif.sh <入力.webm> [出力.gif]
set -euo pipefail

# スクリプト自身の場所を基準にデフォルト出力先を解決する（カレントディレクトリ
# 依存だと、どこから実行するかで出力先が変わってしまうため）。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_OUTPUT="$SCRIPT_DIR/../../../docs/assets/demo.gif"

FFMPEG="${FFMPEG_BIN:-ffmpeg}"
INPUT="$1"
OUTPUT="${2:-$DEFAULT_OUTPUT}"
PALETTE="$(mktemp --suffix=.png)"

trap 'rm -f "$PALETTE"' EXIT

"$FFMPEG" -y -i "$INPUT" -vf "fps=10,scale=400:-1:flags=lanczos,palettegen" "$PALETTE"
"$FFMPEG" -y -i "$INPUT" -i "$PALETTE" \
  -filter_complex "fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  "$OUTPUT"

echo "GIFを生成しました: $OUTPUT"
ls -la "$OUTPUT"
