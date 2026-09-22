#!/usr/bin/env bash
# README用デモGIFの元動画（record-demo.tsが生成した.webm）をGIFに変換する。
#
# 2パス方式（palettegen → paletteuse）でファイルサイズを抑えつつ画質を保つ。
# モバイルサイズの録画なので出力幅400px・10fpsに絞り、README埋め込みに
# 適したファイルサイズに収める。
#
# 使い方: scripts/demo/webm-to-gif.sh <入力.webm> [出力.gif]
set -euo pipefail

FFMPEG="${FFMPEG_BIN:-ffmpeg}"
INPUT="$1"
OUTPUT="${2:-../../../docs/assets/demo.gif}"
PALETTE="$(mktemp --suffix=.png)"

trap 'rm -f "$PALETTE"' EXIT

"$FFMPEG" -y -i "$INPUT" -vf "fps=10,scale=400:-1:flags=lanczos,palettegen" "$PALETTE"
"$FFMPEG" -y -i "$INPUT" -i "$PALETTE" \
  -filter_complex "fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  "$OUTPUT"

echo "GIFを生成しました: $OUTPUT"
ls -la "$OUTPUT"
