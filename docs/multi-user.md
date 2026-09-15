# Multi-user

NextRole runs as two deployments off one codebase. They differ by **one config
value**, not by a branch, a project, or a duplicated service:

| Deployment | `Identity:Mode` | Where the userId comes from |
|---|---|---|
| `private.nextrole.cloud` | `Fixed` | `Identity:FixedUserId` — the single user this instance serves |
| `nextrole.cloud` | `Cookie` | the session the `uid` cookie names |

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

## The hole the wrapper does not cover: the scraper

`UserScopedCollection` makes a missed filter impossible in C#. None of it
reaches Python. The scraper reaches user data over HTTP, where a user-scoped
call that forgets identity **does not fail**: the API's resolver mints a fresh
id, files the write under it, and returns 201. The row is then invisible to the
person who asked for it and to everyone else.

That is not hypothetical. `POST /api/discovery/jobs/{id}/save` shipped without
it, so pressing **Add** on a match created an application owned by a
one-request id — the client refetched the board, the board was empty, and
nothing anywhere logged a problem.

The rule, and the check behind it:

- `tracker_client._request_with_retry` is the single funnel for every call the
  scraper makes into the API, and its `identity` parameter **has no default**.
  Omitting it is a `TypeError` at the call site.
- What travels is `RequestIdentity.credential` — **the session token, not the
  resolved id.** The two are not interchangeable: the API turns a cookie into
  an owner itself, and one it cannot resolve does not get rejected, it gets a
  freshly minted user. Forwarding the id therefore looks exactly like working
  and orphans every write (see below). `IdentityResolver` stays the only code
  that decides who a request is; the scraper never asserts a user any other way.
- `identity=None` is how a call says it is genuinely user-independent — title
  triage, seniority classification, job-facts extraction. An explicit `None` is
  a decision; a missing argument is an oversight.
- A background task has no request and so no token. Under `Fixed` the API reads
  its user from configuration and ignores the cookie, so an instance identity is
  sound there; under `Cookie` there is no provable answer, and the honest move
  is to skip the call rather than send an id that will mint a stranger
  (`orchestrator._run_identity`).
- `tests/test_identity_forwarding.py` walks the AST of `app/services/*.py` and
  fails if any `_request_with_retry` call site omits `user_id`, and checks that
  the four job-action endpoints declare the identity dependency. Verified by
  mutation: reverting any one of the three fixes turns it red.

Work with no request behind it (the demo seeder, the golden-set eval CLIs) has
no user to resolve. `identity.instance_user_id` returns the configured single
user on a `Fixed` instance and **raises** on a `Cookie` one, rather than
scoring against somebody who does not exist.

## Per-user job state on a shared pool document

`dismissed` and `saved_to_tracker` lived on the `discovered_jobs` document.
Harmless with one user; with two, a dismiss hid the posting for everybody and a
save marked it saved for everybody. They are opinions held by a person, exactly
like a score, so they moved to `poolJobState` — one row per `(UserId, JobId)`,
the same shape `jobScores` uses (`app/services/pool_state.py`).

Separate from `jobScores` rather than two more fields on it, because the
scoring path upserts whole score documents and would overwrite them. Two
collections never written by the same code beat one collection with an
ordering hazard.

The read path already loads the user's score rows, so filtering by their own
state costs one more indexed query and shrinks the `$in` on the pool. The
response still carries `dismissed` / `saved_to_tracker` per job, so the client
did not change. Pre-existing flags are migrated on startup
(`_migrate_pool_job_flags`) and attributed to the legacy owner, matching how
the criteria they came from were stamped; the source fields are left in place,
unread, so the change is reversible.

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

`UseUserIdentityCookie` resolves identity on every request and sets `uid` for
any visitor who does not already have a usable session — unconditionally, not on
CV upload. That is what removes the "has this visitor uploaded yet" branch from
everything downstream: by the time any code cares who the user is, the answer
exists.

```
Set-Cookie: uid=<opaque session token>; expires=<+1 year>; path=/; secure; samesite=lax; httponly
```

**The cookie carries an opaque session token, not a userId.** It used to carry
the userId in the clear, which made it an unsigned bearer token: anyone who set
`uid` to a known id had permanent, unrevokable access to that account. That was
tolerable while the private instance sat behind Basic Auth and nothing real
lived on the public one; it is not compatible with exposing `nextrole.cloud`.
The token is 32 CSPRNG bytes and resolves through the `sessions` collection —
full design in `docs/auth.md`, Phase 1.5.

No `Domain`, so the cookie is host-only and scoped to the site the browser
actually asked for. The token is never shown to the user or readable from JS.

Minting an identity creates a session document and nothing else. A bot or a
bounce takes a cookie and leaves no user data behind; the first real document
for a user is the résumé file written by their CV upload, and the TTL collects
the session.

**`IdentityResolver` no longer mints.** It returns the id the middleware parked
for this request and throws otherwise. Minting anywhere else is the orphaned
-write failure described above — the request succeeds, the row is filed under an
id nobody holds, and nothing logs a problem. With sessions there is also nowhere
to put such an id: no session document exists for it, so the browser could never
return to it.

**The API is the only issuer.** The scraper reads the same cookie — both sit
behind the client's nginx on one origin, so the browser sends it to both — and
resolves it against the same `sessions` collection, but never sets one. Two
services minting concurrently on a first page load would race, and the loser's
id, possibly the one a CV had just been uploaded under, would be overwritten in
the browser. Where the API mints for an unknown cookie, the scraper returns
**401**: it cannot write a cookie back, so an id invented there could only ever
be a phantom user.

This makes the session document a **cross-language contract**
(`Core/Models/UserSession.cs`), and it adds a deployment invariant the two
services did not previously have: **they must agree on the database name**, not
just the connection string. `MongoDB:DatabaseName` and `MONGODB_DATABASE_NAME`
pointing at different databases means every scraper request 401s — or resolves
against the wrong instance's sessions.

In `Fixed` mode no cookie is issued and no session is created at all: identity
comes from configuration. The offline CLIs (demo seeder, the golden-set eval
harnesses) depend on that path.

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