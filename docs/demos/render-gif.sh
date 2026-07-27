#!/usr/bin/env bash
# Encode a Playwright-recorded .webm into an optimized, silent, single-purpose
# GIF: two-pass palettegen/paletteuse, cropped to the actual content area (no
# letterboxing — the source video already matches the recorded viewport size,
# see playwright.config.ts), no caption strip, no drawtext.
#
# Usage: ./render-gif.sh <webm-path> <output-gif-path> [fps]
set -euo pipefail

WEBM="${1:?usage: render-gif.sh <webm-path> <output-gif-path> [fps]}"
OUT="${2:?usage: render-gif.sh <webm-path> <output-gif-path> [fps]}"
FPS="${3:-12}"
WIDTH="${4:-960}"

if [ ! -f "$WEBM" ]; then
  echo "render-gif: input not found: $WEBM" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

PALETTE="$(dirname "$OUT")/.palette-$$.png"
trap 'rm -f "$PALETTE"' EXIT

# Pass 1: build an optimized palette for this exact clip (max_colors keeps a
# gradient/font-heavy web UI clean without needless size). Recorded at 1280
# wide but encoded at 960 (README displays these at width=760 anyway, so the
# extra source resolution is invisible weight) — dropping to 960 cuts file
# size substantially with no visible quality loss at display size.
ffmpeg -y -i "$WEBM" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff" \
  "$PALETTE"

# Pass 2: apply the palette. dither=none (not sierra2_4a): dithering
# simulates extra colors by speckling pixels, which fights GIF compression by
# breaking up flat runs — on a UI this size the plain quantized result reads
# just as clean and comes in noticeably smaller. No crop filter needed beyond
# scale — the recording is already tight to the content (fixed viewport ==
# video size, no browser chrome captured, no drawtext/caption strip added).
ffmpeg -y -i "$WEBM" -i "$PALETTE" \
  -lavfi "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none" \
  "$OUT"

echo "render-gif: wrote $OUT"
ls -lh "$OUT"
