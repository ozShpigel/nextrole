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

if [ "$TOTAL" -eq 0 ]; then
  MSG="⚪️ *NextRole — no ingest run detected*
_$(TZ=Asia/Jerusalem date '+%H:%M · %b %d')_"
else
  HITS=""
  COUNT=0
  while IFS= read -r line; do
    score=$(echo "$line" | sed -n 's/.*score=\([0-9]\+\).*/\1/p')
    [ -z "$score" ] && continue
    [ "$score" -le "$THRESHOLD" ] && continue
    company=$(echo "$line" | sed -n 's/.*company=\(.*\) title=.*/\1/p')
    title=$(echo "$line" | sed -n 's/.*title=//p')
    HITS="${HITS}*${score}* · ${title}
_${company}_

"
    COUNT=$((COUNT+1))
  done <<< "$(echo "$RAW" | grep "Job scored" | sort -t= -k3 -rn)"

  if [ "$COUNT" -eq 0 ]; then
    MSG="⚪️ *NextRole — nothing above ${THRESHOLD}*
_$(TZ=Asia/Jerusalem date '+%H:%M · %b %d')_

${TOTAL} jobs scored, none cleared the bar."
  else
    MSG="🟢 *NextRole — ${COUNT} worth a look*
_$(TZ=Asia/Jerusalem date '+%H:%M · %b %d')_

${HITS}_${COUNT} of ${TOTAL} scored above ${THRESHOLD}_"
  fi
fi

curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" \
  -d "parse_mode=Markdown" \
  --data-urlencode "text=$MSG" > /dev/null