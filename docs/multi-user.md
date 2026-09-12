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

## Deferred

Real authentication, per-user Gmail OAuth, and issuing the `uid` cookie
itself — until that lands, a Cookie-mode instance mints a new id per request,
so every request looks like a brand-new user.