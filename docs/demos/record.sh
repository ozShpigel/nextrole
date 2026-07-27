#!/usr/bin/env bash
# Record + encode one demo clip in one command.
#
# Usage: ./record.sh <clip-name>     e.g. ./record.sh search
#        (looks for specs/<clip-name>.spec.ts, writes output/<clip-name>.gif)
#
# Prereqs (see README.md): demo-recording databases seeded (including the
# Atlas jobs_vector_index — semantic search silently returns nothing without
# it), and either your own dev servers already running (this config's
# webServer entries reuse an already-running server on each port, same
# convention as /e2e), or nothing on :5002/:8000/:5173 so Playwright launches
# its own against the demo-recording DBs.
set -euo pipefail

cd "$(dirname "$0")"

NAME="${1:?usage: record.sh <clip-name>, e.g. record.sh search}"
SPEC="specs/${NAME}.spec.ts"

if [ ! -f "$SPEC" ]; then
  echo "record: no such spec: $SPEC" >&2
  exit 1
fi

rm -rf output/test-results
rm -f "output/${NAME}.timing.json"

npx playwright test "$SPEC" --project=chromium

WEBM="$(find output/test-results -name '*.webm' | head -n 1)"
if [ -z "$WEBM" ]; then
  echo "record: no .webm produced under output/test-results — did the test fail?" >&2
  exit 1
fi

TIMING="output/${NAME}.timing.json"
ENCODE_INPUT="$WEBM"

# Specs can optionally log {clickedAtMs, resultsVisibleAtMs, endedAtMs} (see
# specs/search.spec.ts) — an on-demand AI pass has real, mostly-static wait
# time (a disabled button, no spinner animation) that would otherwise be dead
# air in the clip. When present, cut the static middle of that wait down to a
# ~1s tail (still real footage, not sped up or faked) before encoding.
if [ -f "$TIMING" ]; then
  echo "record: trimming static wait using $TIMING"
  TIMES="$(node -e '
    const t = require("./" + process.argv[1]);
    const segAEnd = (t.clickedAtMs / 1000) + 0.4;
    const rawSegBStart = (t.resultsVisibleAtMs / 1000) - 1.0;
    const segBStart = Math.max(segAEnd, rawSegBStart);
    const segBEnd = (t.endedAtMs / 1000) + 0.3;
    console.log(segAEnd.toFixed(2), segBStart.toFixed(2), segBEnd.toFixed(2));
  ' "$TIMING")"
  read -r SEG_A_END SEG_B_START SEG_B_END <<< "$TIMES"

  TRIMMED="output/test-results/${NAME}-trimmed.webm"
  ffmpeg -y -i "$WEBM" -filter_complex \
    "[0:v]trim=start=0:end=${SEG_A_END},setpts=PTS-STARTPTS[a];[0:v]trim=start=${SEG_B_START}:end=${SEG_B_END},setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[outv]" \
    -map "[outv]" "$TRIMMED"
  ENCODE_INPUT="$TRIMMED"
fi

./render-gif.sh "$ENCODE_INPUT" "output/${NAME}.gif"
