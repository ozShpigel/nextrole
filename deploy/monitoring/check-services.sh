#!/bin/bash
set -euo pipefail

cd /srv/nextrole
source .env

EXPECTED="caddy api client scraper demo-api demo-client demo-scraper"
STATE_FILE=/tmp/nextrole-services-down

DOWN=""
for svc in $EXPECTED; do
  status=$(docker compose ps -a --format '{{.State}}' "$svc" 2>/dev/null || echo "missing")
  status=${status:-missing}
  [ "$status" = "running" ] || DOWN="$DOWN $svc($status)"
done

NOW=$(TZ=Asia/Jerusalem date '+%H:%M · %b %d')
TOTAL=$(echo $EXPECTED | wc -w)

send() {
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d "chat_id=$TELEGRAM_CHAT_ID" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=$1" > /dev/null
}

if [ -n "$DOWN" ]; then
  [ -f "$STATE_FILE" ] && exit 0
  touch "$STATE_FILE"

  COUNT=$(echo $DOWN | wc -w)
  LIST=""
  for entry in $DOWN; do
    name=${entry%%(*}
    state=${entry#*(}
    state=${state%)}
    LIST="${LIST}\`${name}\` — ${state}"$'\n'
  done

  send "🔴 *NextRole — service down*
_${NOW}_

${LIST}
_${COUNT} of ${TOTAL} services affected_"

elif [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  send "🟢 *NextRole — all services back up*
_${NOW}_"
fi