#!/bin/bash
set -euo pipefail

cd /srv/nextrole
source .env

LOKI="http://127.0.0.1:3100"
THRESHOLD=70
WINDOW_HOURS=1

END=$(date +%s)000000000
START=$(( $(date +%s) - WINDOW_HOURS*3600 ))000000000

RAW=$(curl -sG "$LOKI/loki/api/v1/query_range" \
  --data-urlencode 'query={service="api"} |= "Job scored" |= "source=ingest"' \
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
  send "⚪️ *NextRole — no ingest run detected*
_${NOW}_"
  exit 0
fi

HITS=""
COUNT=0
RUN_ID=""

while IFS= read -r line; do
  score=$(echo "$line" | sed -n 's/.*score=\([0-9]\+\).*/\1/p')
  [ -z "$score" ] && continue
  [ "$score" -le "$THRESHOLD" ] && continue

  company=$(echo "$line" | sed -n 's/.*company=\(.*\) title=.*/\1/p')
  title=$(echo "$line" | sed -n 's/.*title=\(.*\) jobId=.*/\1/p')
  job_id=$(echo "$line" | sed -n 's/.*jobId=\([0-9a-f-]\+\).*/\1/p')
  [ -z "$RUN_ID" ] && RUN_ID=$(echo "$line" | sed -n 's/.*runId=\([0-9a-f-]\+\).*/\1/p')

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

${HITS}_${COUNT} of ${TOTAL} scored above ${THRESHOLD}_
run \`${RUN_ID}\`"
fi