#!/usr/bin/env bash
#
# Mints a session for the mailbot and writes it into .env.mailbot.
#
# WHY THIS EXISTS
# ---------------
# The mailbot must act AS a user. Against the retired Fixed-mode private
# instance it did not have to say who it was -- identity came from the API's
# own configuration. nextrole.cloud runs Cookie mode, where a client presents
# an opaque session token and a request that presents nothing is answered by
# minting a fresh anonymous user. So a tokenless mailbot reads an empty account
# and reports a successful sync of nothing (issue #67).
#
# This is provisioning, run once (and again to rotate). It is deliberately not
# an API endpoint: an endpoint that mints a session for an arbitrary userId is
# an account-takeover primitive, and it would have to be authenticated by
# something -- which is the problem it was meant to solve.
#
# SECRETS
# -------
# The token is a bearer credential for the whole account. It is never printed,
# never passed on a command line (where `ps` would see it), and goes straight
# into .env.mailbot, which sits alongside the Mongo connection string and the
# Anthropic key already. The connection string is passed to the container as an
# env var for the same reason.
#
# USAGE
#   cd /srv/nextrole && ./mint-mailbot-session.sh [<userId>]
#
# With no argument it uses the sole row in googleIdentity, and refuses if there
# is not exactly one -- guessing which account the mailbot should be is the one
# mistake that would be invisible afterwards.

set -euo pipefail

cd "$(dirname "$0")"

ENV_API=".env.api"
ENV_MAILBOT=".env.mailbot"
LIFETIME_DAYS=365

[ -r "$ENV_API" ]     || { echo "ERROR: $ENV_API not found (run this in /srv/nextrole)"; exit 1; }
[ -r "$ENV_MAILBOT" ] || { echo "ERROR: $ENV_MAILBOT not found"; exit 1; }

# Read, never echo. `grep -m1` so a stray duplicate key does not silently win.
URI=$(grep -m1 '^MongoDB__ConnectionString=' "$ENV_API" | cut -d= -f2-)
DB=$(grep  -m1 '^MongoDB__DatabaseName='     "$ENV_API" | cut -d= -f2-)
[ -n "$URI" ] || { echo "ERROR: MongoDB__ConnectionString missing from $ENV_API"; exit 1; }
[ -n "$DB" ]  || { echo "ERROR: MongoDB__DatabaseName missing from $ENV_API"; exit 1; }
echo "Database: $DB   (connection string read, ${#URI} chars, not shown)"

USER_ID="${1:-}"

# 32 CSPRNG bytes, base64url, padding stripped -- byte-for-byte the format
# SessionIdentityResolver.NewToken() produces. A token of a different shape
# would still work (the collection is the only authority on what a token means)
# but would be the one session that looks unlike every other, which is exactly
# the kind of detail that confuses whoever debugs this next.
TOKEN=$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')

OLD_TOKEN=$(grep -m1 '^Tracker__SessionToken=' "$ENV_MAILBOT" | cut -d= -f2- || true)

# The script goes in on stdin so neither the token nor the URI appears in the
# container's argv. Field names match Core/Models/UserSession.cs exactly; that
# document is a cross-language contract (the scraper reads it too) and a typo
# here produces a session that simply never resolves.
RESULT=$(docker run --rm -i \
    -e URI="$URI" -e DB="$DB" -e TOKEN="$TOKEN" \
    -e USER_ID="$USER_ID" -e OLD_TOKEN="$OLD_TOKEN" -e DAYS="$LIFETIME_DAYS" \
    mongo:7 sh -c 'mongosh "$URI" --quiet' <<'JS'
const db  = db.getSiblingDB(process.env.DB);
const now = new Date();

let userId = process.env.USER_ID;
if (!userId) {
  const links = db.googleIdentity.find({}, { _id: 1 }).toArray();
  if (links.length !== 1) {
    print("FAIL: googleIdentity has " + links.length + " rows; pass the userId explicitly");
    quit(1);
  }
  userId = links[0]._id;
}

if (!db.getCollection("applications").findOne({ UserId: userId })) {
  print("FAIL: no applications owned by " + userId + " — wrong user, or wrong database");
  quit(1);
}

if (process.env.OLD_TOKEN) {
  const gone = db.sessions.deleteOne({ _id: process.env.OLD_TOKEN });
  print("rotated: removed " + gone.deletedCount + " previous mailbot session");
}

db.sessions.insertOne({
  _id:              process.env.TOKEN,
  UserId:           userId,
  IssuedAt:         now,
  LastSeenAt:       now,
  ExpiresAt:        new Date(now.getTime() + Number(process.env.DAYS) * 86400000),
  FromLegacyCookie: false,
});

print("OK " + userId + " " + db.getCollection("applications").countDocuments({ UserId: userId }));
JS
) || { echo "$RESULT"; echo "ERROR: minting failed — nothing written to $ENV_MAILBOT"; exit 1; }

echo "$RESULT" | grep -v '^OK ' || true
echo "$RESULT" | grep -q '^OK ' || { echo "$RESULT"; exit 1; }

read -r _ MINTED_FOR APP_COUNT <<<"$(echo "$RESULT" | grep '^OK ')"

# Replace rather than append: a duplicate key in an env file is read by
# whichever side of the pipeline happens to win, which is not a thing to leave
# to chance for a credential.
tmp=$(mktemp)
grep -v '^Tracker__SessionToken=' "$ENV_MAILBOT" > "$tmp" || true
printf 'Tracker__SessionToken=%s\n' "$TOKEN" >> "$tmp"
cat "$tmp" > "$ENV_MAILBOT"     # preserves the original file's mode
rm -f "$tmp"
unset TOKEN OLD_TOKEN URI

echo
echo "Minted a ${LIFETIME_DAYS}-day session for ${MINTED_FOR} (${APP_COUNT} applications)."
echo "Written to ${ENV_MAILBOT} as Tracker__SessionToken (value not shown)."
echo
echo "Verify with a real run — it now refuses to sync as the wrong user:"
echo "  docker compose --profile cron run --rm mailbot"
echo "Expect a 'Syncing as <email>' line and a non-zero count of applications."
