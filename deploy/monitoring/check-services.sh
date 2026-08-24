#!/bin/bash
set -euo pipefail

cd /srv/nextrole
source .env

EXPECTED="caddy api client scraper demo-api demo-client demo-scraper"
DOWN=""

for svc in $EXPECTED; do
  status=$(docker compose ps --format '{{.State}}' "$svc" 2>/dev/null || echo "missing")
  [ "$status" = "running" ] || DOWN="$DOWN $svc($status)"
done

STATE_FILE=/tmp/nextrole-services-down

if [ -n "$DOWN" ]; then
  # only alert once per incident
  [ -f "$STATE_FILE" ] && exit 0
  touch "$STATE_FILE"
  MSG="🔴 NextRole — service down:%0A$DOWN"
elif [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  MSG="🟢 NextRole — all services back up"
else
  exit 0
fi

curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" -d "text=$MSG" > /dev/null