#!/bin/bash
set -euo pipefail

cd /srv/nextrole
source .env

LOKI="http://127.0.0.1:3100"
THRESHOLD=70
# 24h, not 1h. The old window was an hour because the digest ran immediately
# after a nightly run that did the scoring, so everything worth reporting had
# just happened. THAT IS NO LONGER TRUE: the pool ingest does NOT score
# (orchestrator.py: "Ingest does NOT score. Scoring is per user and on
# demand"), so at 05:30 UTC the preceding hour holds whatever users scored by
# opening Matches -- which at 05:30 is nobody. A one-hour window would report
# "nothing" every day, correctly and uselessly.
WINDOW_HOURS=24

END=$(date +%s)000000000
START=$(( $(date +%s) - WINDOW_HOURS*3600 ))000000000

# `service="api"` reads the same as it always did but now means something
# different: `api` was the private instance until the teardown and is
# nextrole.cloud afterwards. This query is correct here for the first time --
# see issue #64 for how long it was pointed at the wrong stack.
#
# source=pool, not source=ingest. `ingest` was the scraper's criteria-driven
# run calling /api/match/discovery-score-batch with an X-Source header. That
# service is retired, and more to the point ingest stopped scoring at all.
# Scoring is the per-user scan now (PoolScanService) -- browser-driven, so it
# sends no X-Source and logged source=(null) until the server began stamping
# Source="pool" onto the batch request.
#
# What this measures has genuinely changed, and the message says so: no longer
# "what last night's run found" but "what anyone's scan scored in 24h". Note
# the same job appears once per user who scored it -- the log line carries no
# userId, so duplicates are indistinguishable here.
RAW=$(curl -sG "$LOKI/loki/api/v1/query_range" \
  --data-urlencode 'query={service="api"} |= "Job scored" |= "source=pool"' \
  --data-urlencode "start=$START" \
  --data-urlencode "end=$END" \
  --data-urlencode "limit=1000" \
  | jq -r '.data.result[].values[][1]')

TOTAL=$(echo "$RAW" | grep -c "Job scored" || true)
NOW=$(TZ=Asia/Jerusalem date '+%H:%M · %b %d')

send() {
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_CHAT_ID" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=$1" > /dev/null
}

if [ "$TOTAL" -eq 0 ]; then
  send "⚪️ *NextRole — nothing scored in ${WINDOW_HOURS}h*
_${NOW}_"
  exit 0
fi

HITS=""
COUNT=0

while IFS= read -r line; do
  score=$(echo "$line" | sed -n 's/.*score=\([0-9]\+\).*/\1/p')
  [ -z "$score" ] && continue
  [ "$score" -le "$THRESHOLD" ] && continue

  company=$(echo "$line" | sed -n 's/.*company=\(.*\) title=.*/\1/p')
  title=$(echo "$line" | sed -n 's/.*title=\(.*\) jobId=.*/\1/p')
  job_id=$(echo "$line" | sed -n 's/.*jobId=\([0-9a-f-]\+\).*/\1/p')

  HITS="${HITS}*${score}* · ${title}
_${company}_
\`${job_id}\`

"
  COUNT=$((COUNT+1))
done <<< "$(echo "$RAW" | grep "Job scored" | sort -t= -k3 -rn)"

if [ "$COUNT" -eq 0 ]; then
  send "⚪️ *NextRole — nothing above ${THRESHOLD}*
_${NOW}_

${TOTAL} jobs scored, none cleared the bar."
else
  send "🟢 *NextRole — ${COUNT} worth a look*
_${NOW}_

${HITS}_${COUNT} of ${TOTAL} scored above ${THRESHOLD}, last ${WINDOW_HOURS}h_"
fi
