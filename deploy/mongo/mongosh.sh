#!/bin/sh
# Run one mongosh script against Atlas with a service's own credentials, from
# the mongo:7 image -- the box has no mongosh, and this never prints or asks
# for the connection string.
#
# In /srv/nextrole, with the script copied next to this file:
#   sh mongosh.sh check-key-backfill.js                 # uses .env.greenhouse
#   sh mongosh.sh fill-pool-demand.js .env.api
set -eu
script="$1"
envfile="${2:-.env.greenhouse}"
[ -f "$script" ] || { echo "no such script: $script" >&2; exit 1; }
[ -f "$envfile" ] || { echo "no such env file: $envfile" >&2; exit 1; }
docker run --rm --env-file "$envfile" -v "$PWD/$script:/s.js:ro" mongo:7 \
  sh -c 'mongosh --quiet "$MongoDB__ConnectionString" /s.js'
