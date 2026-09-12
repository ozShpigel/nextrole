# Multi-user

NextRole runs as two deployments off one codebase. They differ by **one config
value**, not by a branch, a project, or a duplicated service:

| Deployment | `Identity:Mode` | Where the userId comes from |
|---|---|---|
| `private.nextrole.cloud` | `Fixed` | `Identity:FixedUserId` — the single user this instance serves |
| `nextrole.cloud` | `Cookie` | the `uid` cookie |

Resolution is the only code that knows which one it is. Query, scoring and pack
code receive a plain `Guid` and cannot tell the difference — there is no
`if (demoMode)` / `if (cookieMode)` branch anywhere downstream.

## Resolving the user

`IdentityResolver` (`server/api/src/Api/Identity/`) validates its configuration
once at construction: `Fixed` with a missing or nil `FixedUserId` throws at
startup rather than quietly serving every visitor the same data. The scraper
mirrors it exactly in `server/scraper/app/identity.py`
(`IDENTITY_MODE` / `IDENTITY_FIXED_USER_ID`).

In `Cookie` mode an absent or unparseable cookie **mints a fresh id**. There is
no anonymous account and no demo persona to fall back to: a visitor with no
cookie is simply a user we have not met. Minting creates nothing — the first
document for a user appears only when they upload a CV.

Endpoints take the resolved id as a handler parameter (`IUserContext user`) and
pass `user.UserId` down. Background work takes it as an explicit argument —
`EnrichOnInterviewingAsync(userId, appId, scopeFactory)` — because the request
scope is gone by the time it runs.

## Two document shapes

**One-per-user documents** — `profile`, `resumeFile`, `interviewInsights` — use
`_id = userId`. The id *is* the scope, so these stay single-document-lookup
providers: there is no query-by-field path, no uniqueness constraint to enforce
by hand, and no way to write a lookup that forgets to scope itself.

**Many-per-user collections** — `applications`, `interviews`, `notes`,
`statusUpdates`, `messages`, `matchSnapshots`, `resumePacks`,
`mockInterviewSessions` — carry a `UserId` field (`IUserOwned`) and an index on
it.

`discovered_jobs` and `discovery_runs` are **shared** by design: the job pool is
common to everyone. `search_criteria` is user-scoped (`user_id`), in the scraper.

## Why a missed filter cannot happen

A convention ("remember to filter by userId") is not a check. So repositories
never see a raw `IMongoCollection<T>`; they get `UserScopedCollection<T>`, which

- has **no overload that omits the userId**, and ANDs the equality clause on
  inside the wrapper rather than at the call site, and
- **asserts on write** that the document's own `UserId` matches the caller's, so
  a repository that forgets to stamp a new row fails loudly instead of writing
  one nobody can read.

`UserScopedCollection` is a one-way door: it holds the raw handle privately and
exposes no way to get it back out. Index creation and the migration - the only
jobs that legitimately span users - take their own `IMongoCollection<T>` from DI
instead, so no escape hatch is needed. (There was a `.Unscoped` property for
exactly that purpose; writing the architecture test showed it had no callers, so
it was removed.) `ArchitectureTests` asserts both halves: the wrapper exposes no
member returning the raw collection, and raw-collection access stays confined to
the index/migration/registration/seeder allowlist.

`UserId` is `[JsonIgnore]`: a request body can never claim one, and a response
can never leak one.

## Uniqueness is per user

Two users tracking the same job at the same company are not duplicates. The
pre-multi-user unique indexes are dropped by name at startup and rebuilt with
the user in the key:

- `uniq_company_jobtitle_ci` → `uniq_user_company_jobtitle_ci` on
  `(UserId, Company, JobTitle)`
- `uniq_gmailmessageid` → `uniq_user_gmailmessageid` on `(UserId, GmailMessageId)`

`applications` also carries a plain `idx_userid`: the unique index above is
prefixed by `UserId` but carries a collation, and a plain string-equality query
cannot use a collation index — a list query would otherwise fall back to a
collection scan.

## Migration (`UserScopeMigrationInitializer`)

Runs at startup, **before** the indexes — a unique index containing `UserId`
cannot build while legacy documents still share an empty value. Nothing is
deleted.

1. Collections that gained `UserId`: every document without one is stamped with
   the legacy owner.
2. Documents that were fixed singletons (`profile` with `id: "default"`,
   `resumeFile` / `interviewInsights` with `_id: "current"`) are re-keyed onto
   `_id = userId`. `_id` is immutable, so the document is copied first and the
   old one deleted second: a crash in between leaves the data intact rather than
   lost. It refuses to overwrite a document already sitting under the new key.

The legacy owner is whoever the instance already served: its configured fixed
user in `Fixed` mode, and in `Cookie` mode a well-known id
(`UserIds.OrphanedLegacyData`) that nothing reads — the rows are parked, not
deleted, and can be found again if anyone wants them.

The migration is idempotent; a second startup logs nothing.

It is **fatal**. Connection-level failures are retried (5 attempts, doubling
backoff); anything still failing after that brings the process down rather than
serving requests against a database whose shape does not match what the code
expects. A deterministic failure -- a duplicate key, a schema surprise -- fails
immediately, since retrying cannot fix it. Index creation next to it stays
best-effort: missing indexes cost correctness guarantees and speed, not user
isolation.

## Issuing the cookie

`UseUserIdentityCookie` sets `uid` on the first request from any visitor who
does not already have one — unconditionally, not on CV upload. That is what
removes the "has this visitor uploaded yet" branch from everything downstream:
by the time any code cares who the user is, the answer exists.

```
Set-Cookie: uid=<guid>; expires=<+1 year>; path=/; secure; samesite=lax; httponly
```

No `Domain`, so the cookie is host-only and scoped to the site the browser
actually asked for. There is no login, no recovery, and the id is never shown
to the user or readable from JS.

Minting an id still creates nothing. A bot or a bounce takes a cookie and
leaves no rows behind; the first document for a user is the résumé file written
by their CV upload.

**The API is the only issuer.** The scraper reads the same cookie — both sit
behind the client's nginx on one origin, so the browser sends it to both — but
never sets one. Two services minting concurrently on a first page load would
race, and the loser's id, possibly the one a CV had just been uploaded under,
would be overwritten in the browser.

In `Fixed` mode no cookie is issued at all: identity comes from configuration
and there is nothing to persist in a browser.

### Origins

Client, API and scraper are same-origin in both environments — the Vite dev
proxy (`client/vite.config.js`) in development, the client's nginx
(`client/nginx.conf`) in production — so the cookie flows without CORS being
involved at all. The client still sends `credentials: 'include'` and both
services still enable CORS credentials when their allowed origins are listed
explicitly, so that pointing `VITE_API_URL` / `VITE_SCRAPER_URL` at a different
host keeps working instead of silently losing identity. A wildcard `*` origin
cannot carry credentials — that is a CORS rule, not a choice.

## Deferred

Real authentication and per-user Gmail OAuth. Cookie issuance is in place; the
daily ingest is still profile-driven (see Step 4).