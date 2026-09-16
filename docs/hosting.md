# Hosting

`nextrole.cloud` is the only deployment. It runs `api`, `scraper` and `web` from
one image set on one VPS, behind Caddy. The mechanics — compose services, env
files, workflows, monitoring — are in [`deploy/README.md`](../deploy/README.md);
this file covers the parts that are decisions rather than steps.

There used to be a second, public, read-only instance serving seeded fictional
data behind `DemoMode=true`, documented here and in `docs/demo-mode.md`. Sign-in
replaced the reason for it, its databases are dropped, and the flag and both
write-gate middlewares are deleted. If you want a public instance nobody can
change, this is not the mechanism to reach for — there isn't one.

## Least-privilege database credentials

**Don't give the deployment an admin connection string.** Create an Atlas
database user scoped to exactly the two databases the instance uses, so a leaked
or misconfigured credential cannot reach anything else.

In the Atlas console (`https://cloud.mongodb.com` → your project):

1. **Security → Database Access → Add New Database User**
   - Autogenerate a password (letters/numbers only, or URL-encode special
     characters in the connection string).
   - **Database User Privileges → Specific Privileges**, add exactly two:
     - `readWrite` on `job-tracker`
     - `readWrite` on `jobmatch`
2. **Database → Connect → Drivers** → copy the `mongodb+srv://…` string.

Prove the isolation rather than assuming it — `mongosh "<string>"`:

```
use job-tracker      → db.applications.countDocuments()   // works
use some-other-db    → db.applications.countDocuments()   // auth error = good
```

The auth error is the desired outcome.

**Repointing a database without repointing the credential fails at boot, and the
error blames the wrong thing.** `UserScopeMigrationInitializer` issues an
unconditional `updateMany` per collection, so it needs write privilege even with
nothing to migrate — and the exception names the migration, not the credential
(issue #57).

`readWrite` does **not** include `collMod`, which is why the scraper logs a TTL
index error on every boot (issue #68). The existing index stays in force; what
silently does not work is *changing* it.

## The `ApiKey` gate

Optional, and orthogonal to who a user is. Setting `ApiKey` on the API means
every request must carry a matching `X-Api-Key` header or get a 401
(constant-time compare; `/health`, `/api/config` and OPTIONS stay open —
middleware in `Program.cs`). It predates sign-in and gates the *instance*, not a
user: a privately hosted deployment used it to keep strangers out when there was
no login at all.

`nextrole.cloud` leaves it unset — it authenticates users instead
([`docs/auth.md`](auth.md)). **It is a gate, not an identity: it authorizes a
request and selects no user.** Sending it and nothing else against a Cookie-mode
instance is how the mailbot spent an hour syncing an empty account (issue #67).

## Two things that are easy to get wrong

- **The scraper must point at the same database as the API.** In Cookie mode it
  resolves sessions by reading that database's `sessions` collection directly
  ([`docs/auth.md`](auth.md)), so a mismatch means every scraper request 401s —
  or, worse, resolves against another instance's sessions. Nothing checks this.
- **CORS is required, not optional.** The browser calls the API and scraper
  directly, so `CorsOrigins` / `CORS_ORIGINS` must list the exact frontend origin
  (`https://…`, no trailing slash). It defaults to empty, which blocks everything.

## Fictional data

`server/api/src/Seeder` and `app/services/demo_seed.py` still exist. Their only
consumer is [`docs/demos`](demos/README.md), which records the per-feature clips
against a persistent seeded database so a clip stays reproducible.

**Confirm a database name is free before seeding into it.** The seeder deletes
and reinserts per seed user, so the blast radius is bounded by nothing except
which database it was pointed at — a "scratch" name that turns out to be real
means it writes into live data. It has already cost two documents written into a
real database, caught only because a legacy unique index happened to abort the
run. With the `-demo` databases now dropped, a stale `--db job-tracker-demo`
argument no longer lands somewhere harmless.
