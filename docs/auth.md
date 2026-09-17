# Authentication

**Status by phase:**

| Phase | State |
|---|---|
| 1 — Google sign-in | **Deployed** on `nextrole.cloud`. Verified end to end against a restored copy of real data first. |
| 1.5 — server-side sessions | **Deployed.** This is what makes public exposure safe. |
| 1.6 — anonymous merge on sign-in | **Deployed.** |
| 2 — email sign-in, passkeys | Design only. |

Phases 1 through 1.6 are live on `nextrole.cloud`. `private.nextrole.cloud` was
retired on 2026-09-16 — sign-in is what removed the need for it.

## Where this started

In production there is still no authentication, deliberately. A visitor is
identified by the `uid` cookie and nothing else — no login, no password, no recovery, no account. The
full reasoning is in `docs/multi-user.md`; the short version is that it was the
right trade for a personal-scale tool, and it is why user scoping had to be made
structural (`UserScopedCollection`) rather than diligent: there is no auth layer
standing behind it.

That trade has one cost, and it is the reason this document exists. **Clearing
cookies, switching browser, or switching device loses the account forever.**
There is no way back in, because there is nothing to prove you were ever here.

## What changes, and what must not

Real accounts are the destination: email sign-in, social providers, passkeys.
The risk in getting there is that an auth system arrives with its own idea of
who a user is, and the codebase ends up with two.

So the governing rule:

> **The `Guid` stays the identity. Authentication decides *which* Guid you are —
> it does not replace it.**

```
  sign-in (Google, email, passkey…)    ← changes over time
              │
              ▼
      IdentityResolver → Guid          ← the only code that knows the deployment
              │
              ▼
  UserScopedCollection, jobScores, poolJobState,
  _id = userId documents, the scraper's uid forwarding
                                       ← never learns auth exists
```

Everything below the resolver already takes a plain `Guid` and cannot tell a
`Fixed` instance from a `Cookie` one. Auth slots in *above* the resolver, as one
more way of answering the same question. Concretely, none of this changes:

- `UserScopedCollection<T>` and the `ArchitectureTests` that guard it
- `_id = userId` documents (`profile`, `resumeFile`, `interviewInsights`)
- `UserId` + index on the many-per-user collections
- `jobScores` / `poolJobState` on the shared pool
- `tracker_client._request_with_retry(user_id=…)` in the scraper, and
  `app/identity.py`'s cookie read

The alternative — letting an auth library's own user id become the primary key —
means migrating three services and an architecture test, and marrying the
library permanently. Not worth it for a login button.

`Fixed` mode has no cookie and one configured user, so authentication no-ops
there exactly as `UseUserIdentityCookie` already does. The two modes keep
differing by configuration only. It had a hosted instance
(`private.nextrole.cloud`) until 2026-09-16 and is still what the eval CLIs run.

## Phase 1 — Google sign-in as recovery

Scope: a returning visitor who lost their cookie gets their account back.
Nothing is required of anyone else. Upload-a-CV stays the whole onboarding.

- `GET /api/auth/google/start` — redirect to Google's consent screen (PKCE +
  `state`, both carried in a short-lived `nr_oauth` cookie). 404s when no
  credentials are configured, and in `Fixed` mode where sign-in is meaningless.
- `GET /api/auth/google/callback` — verify the ID token, resolve the account.
- `POST /api/auth/signout` — drop the session (not the account).
- `GET /api/auth/me` — `signedIn`, `email`, and `available`. The client gates
  the landing-page link on `available`, because it otherwise cannot tell a
  `Cookie` instance from a `Fixed` one and would offer a link that cannot work.

The OIDC code flow is written out in `AuthEndpoints` rather than taken from
`Microsoft.AspNetCore.Authentication.Google`, which wants to own a sign-in
scheme and issue its own auth cookie — a second session concept alongside
`uid`. The security-critical half is *not* hand-rolled: signature, `iss`, `aud`
and expiry are checked by `GoogleJsonWebSignature`.

Storage: one-per-user document `googleIdentity`, `_id = userId`, holding
Google's `sub`, plus the email for display only. **Link on `sub`, never on
email** — Google emails can change and be reassigned; `sub` is stable and unique
forever.

### The collision rules

A visitor signs in with a Google account already linked to user **A**, while
their current cookie is user **B**:

| B's state | What happens |
|---|---|
| Owns nothing | Adopt A. Nothing to move. |
| Owns something | Adopt A, and **merge B into it** (Phase 1.6). Nothing is lost, so nothing is asked. |
| B already linked to a *different* Google account | Refuse, and say so. Two accounts are being conflated. |

The middle row used to be a prompt, on the reasoning that silent merge and
silent discard both destroy somebody's work. That holds for a *discard* — it
does not hold once the data is genuinely merged. See "`NeedsChoice` is retired".

The resolver reports the merge rather than performing it, so it stays free of
I/O and the rules remain testable without a database. All three rows are
asserted in `GoogleSignInResolverTests`.

### The one-shot claim

The pre-auth data on an instance belongs to a userId nobody can prove they own,
because there was never a login. The claim hands it over once: a Google sign-in
adopts that userId instead of the empty one the visitor's cookie just minted. It
is how `private.nextrole.cloud`'s history moved to `nextrole.cloud` under a real
account — that migration has run (`googleIdentity` records `ViaClaim: true`), and
the three claim values have since been removed from the environment.

It takes **three configuration values, all of them or none**. Any partial
combination refuses to start.

| Key | What it answers |
|---|---|
| `Google:ClaimUserId` | *which* account is being handed over |
| `Google:ClaimEmail` | *who* is allowed to take it |
| `Google:ClaimExpiresAt` | *when* the offer stops existing |

Half a claim is a configuration mistake in both directions, which is why
startup fails rather than warning. `ClaimUserId` alone is the dangerous half —
see below. `ClaimEmail` or `ClaimExpiresAt` alone is harmless but means somebody
configured a migration that can never fire, and may reasonably conclude the
feature is broken.

#### Why it has to name a person

With `ClaimUserId` alone, **the account goes to whoever signs in first.** On a
private instance nobody else can reach, that is fine. On a public one it is an
account takeover waiting for a stranger to be quick, and the value is exactly
the kind that gets copied into a production env file during a migration and left
there.

"Remember not to set it in production" is not a control. `ClaimEmail` is:
only the named Google account may take the claim, so a forgotten `ClaimUserId`
is inert to everyone except the person it names.

**Verification is checked as a separate flag, not inferred from the address.**
An email Google has not marked verified is one nobody has proved they own, so
matching on the string alone would let an impostor assert the owner's address
and walk off with the history. `GoogleSignInResolver.ResolveAsync` takes
`emailVerified` as an explicit parameter for that reason — the decision must not
be able to drift if a caller later starts passing the raw value through.

A refused attempt is **logged with the signer**. Somebody arriving at an armed
claim and being turned away is the one event here worth seeing.

#### Why it has to expire

A migration hatch that closes only when someone remembers to close it stays open.
`ClaimExpiresAt` is an absolute UTC instant, and past it the API **refuses to
start**, naming the three lines to delete. The hatch closes on a date rather than
on anyone's diligence.

Parsed with `TryParseExact` against explicit ISO formats and `AssumeUniversal`,
so `2026-10-01`, `…T00:00:00` and `…T00:00:00Z` are the same instant everywhere
and a bare date means midnight UTC rather than midnight wherever the server
happens to sit. `01/10/2026` is **rejected outright** rather than meaning January
in one locale and October in another — this value decides when a takeover window
closes, so a lenient parse is not a convenience.

Enforced **twice**: at startup, and again on every claim attempt. A container
that booted before the deadline and is not redeployed for months is precisely
the case the deadline exists to end, and a startup-only check would leave it
armed for as long as the process happens to stay up.

#### Rejected: refusing to boot once the target is linked

The obvious companion was a startup check failing when `ClaimUserId` is set and
the target already has a `googleIdentity` document — forcing removal by making
the config unable to outlive its use.

**It fails open.** The check reads database state, so deleting that link makes it
stop failing and the claim silently re-arms. Account deletion is an open
question in this document, and when it lands it would do exactly that. A guard
whose behaviour inverts on an unrelated feature nobody would connect to it is
not a guard.

It also trades an inert config line for an outage: once consumed, the claim is
already dead by the data gate below, and with the pin it is inert to everyone
but its owner anyway. A date cannot be un-passed by anything happening in the
database, which is why the expiry does this job instead.

#### It still cannot be re-armed by configuration

Independently of the three keys, the claim is gated on the target having no
`googleIdentity` document — a fact in the database, not a flag. Once consumed,
the branch is dead however the config is set.

Two concurrent first sign-ins can both pass that read, so the insert arbitrates:
`TryLinkAsync` is insert-if-absent and the loser falls through to an ordinary
sign-in. That is why `uniq_googlesub` is created in the **fatal** startup block
rather than the best-effort one — see `Program.cs`. Every other index there is
deduplication; this one is half of the guard, and `_id` uniqueness only covers
the other half.

A refused attempt never consumes the claim. Otherwise anyone could disarm the
migration by signing in once, and it would silently stop working.

### Demo mode

The auth endpoints are **not** added to the `Program.cs` allowlist, and the
landing-page link is already hidden when `demoMode` is true. A read-only demo
with a fixed persona has nothing to sign into.

## Phase 1.5 — server-side sessions

This is what makes `nextrole.cloud` safe to expose publicly. **Optional sign-in
does not fix it**: anonymous visitors still get a cookie, so the cookie remains
the identity mechanism for most traffic.

Today `uid` is an **unsigned bearer token with a one-year expiry**. On a public
site that means anyone can set it to a known userId and read that person's
entire history. It is tolerable today only because the private instance sits
behind Basic Auth and nothing real lives on the public one.

### The sessions collection

`uid` stops carrying a userId and carries an opaque token instead;
`IdentityResolver` looks the token up rather than trusting what the browser
sent.

`sessions`, in `job-tracker`:

| Field | |
|---|---|
| `_id` | 32 CSPRNG bytes, base64url. 256 bits, no structure, never a userId |
| `UserId` | who the token resolves to |
| `IssuedAt` / `ExpiresAt` / `LastSeenAt` | lifetime and coarse audit |

**No client IP.** It is personal data on a site with no privacy policy, and it
is not load-bearing for anything here.

- TTL index on `ExpiresAt` (`expireAfterSeconds: 0`) — the precedent is
  `matchSnapshots` (90d) and the scraper's `discovered_jobs` (60d).
- **The TTL is cleanup, not correctness.** Mongo's TTL monitor runs roughly
  every 60 seconds, so an expired session lingers. `ExpiresAt > now` belongs in
  the *query*, or an expired session stays usable for up to a minute.
- Sliding expiry, throttled: only rewrite `ExpiresAt` when it is more than a day
  stale, otherwise every request becomes a write.
- Anonymous visitors still get a session, bound to a freshly generated userId
  they cannot name. Nothing else about anonymous use changes.
- Sign-out deletes the document. "Sign out everywhere" — delete every session
  for a userId — becomes possible for the first time.
- `Fixed` mode is untouched: configured Guid, no cookie, no session. The
  offline CLIs (the golden-set evals in `server/api/src/EvalHarness`) keep working.

### The scraper resolves sessions from Mongo

`server/scraper/app/identity.py` parses the `uid` cookie as a UUID. An opaque
token makes `_parse()` return `None`, `resolve()` mints a fresh random id, and
**every scraper write files under a phantom user** — the orphaned-write failure
described in `docs/multi-user.md`, but silent and across all scraper traffic.

**Decided: the scraper reads `sessions` from Mongo directly.** It already shares
nine collections with the API, so this is the existing coupling rather than a
new one. An API call per scraper request would make the API a hard dependency of
the scraper's request path; a stateless signed token gives up instant
revocation, which is most of the point.

Two consequences:

- **The session schema is a cross-language contract.** Neither side changes it
  alone. That is why it is written down here rather than only in C#.
- `tests/test_identity_forwarding.py` already walks the AST; it gains a guard
  that the scraper never parses the identity cookie as a UUID again.

### Cutover

Every existing visitor holds `uid=<guid>`. On deploy those become unresolvable
and every anonymous account is orphaned. So: **a cookie that parses as a Guid
mints a session bound to that same userId and replaces the cookie.**

Time-limited to **three months**, then the grace path is removed. Low stakes on
today's `nextrole.cloud` — it is the demo — but it has to be deliberate rather
than discovered.

## Phase 1.6 — merging an anonymous account on sign-in

Someone uploads a CV and gets matches before signing in. On sign-in:

- **Google account not linked yet** — their current anonymous userId becomes the
  linked one. Nothing moves.
- **Already linked to a different userId** — the anonymous account's documents
  are reassigned to the linked one, and the anonymous userId is retired.

### `NeedsChoice` is retired

Phase 1 prompted whenever the session held data. That was right when one side's
data would be lost; merging loses nothing, so prompting became friction for no
benefit.

It was briefly going to survive, narrowed to the case where a singleton exists
on both sides. What killed it was the cost: the conflict is discovered *during*
the callback, so the browser is still the anonymous session when the question is
asked — meaning a second signed pending-merge flow, consumed by its own
endpoint, plus client UI, all to ask a question most people would click through.

**So: merge everything, the signed-in account keeps its singleton, the anonymous
one is parked, and the user is told afterwards.** Parked means left in place
under the retired userId — the same posture as `UserIds.OrphanedLegacyData` and
the pool's inactive listings. Nothing is deleted.

The concern the prompt existed to address is real and is handled instead by the
notice below: silently keeping the account's profile means someone uploads a CV,
signs in, and their CV appears not to have been read.

### The notice is the load-bearing half

A parked document nobody is told about is **silent loss with extra steps**. So
the requirement is that the notice *shows* — visible on the next load, not
findable by someone who already knows to look.

That rules out a toast: the merge happens during the sign-in redirect, so the
page that would show one is the page being navigated away from. It also rules
out `localStorage`: a notice must survive the reload, and must not reappear on
another device after being dismissed.

So notices are server-side (`userNotices`, `_id = userId`), read by the app
shell on every page load, and dismissed server-side. The server records *what
happened*; the client owns the wording, so copy stays where the design tokens
are. The notice carries the retired userId, which is what makes "parked"
recoverable rather than a nicer word for deleted.

**Not built: restoring a parked document.** The notice says it has not been
deleted and to ask for it. A one-click restore is the obvious next step and is
deliberately not in this pass.

### Three shapes, not one

**(a) `UserId` field — plain `updateMany`.** `applications`, `interviews`,
`notes`, `statusUpdates`, `messages`, `matchSnapshots`, `resumePacks`,
`mockInterviewSessions`.

`matchSnapshots` belongs here and is safe: its `_id` is a SHA-256 of content
only, with no userId in it, so an update cannot collide.

**`jobScores` does NOT belong here**, though it was listed here when this
document was first written. Its `_id` is `"{userId}:{jobId}"` — see (c).

**(b) `_id = userId` singletons — copy-then-delete.** `profile` and `resumeFile`
live in **`jobmatch`**, a different database; `interviewInsights` in
`job-tracker`. `_id` is immutable, so these follow `RekeyAsync`'s
copy-then-delete, and both sides may already hold one.

**(c) The traps.**

- `search_criteria` — `user_id`, **snake_case**. This one has bitten before.
- `jobScores` and `poolJobState` — `_id` is `"{userId}:{jobId}"`, so the userId
  sits **inside the immutable primary key**. An `updateMany` on the `UserId`
  field updates the field and leaves `_id` still naming the old user. Every row
  needs re-keying, with a possible collision where both users hold a row for
  the same job.

  Getting this wrong does not look like a failure. `JobScore`'s own comment
  says the key exists "so an upsert cannot create two rows for the same pair" —
  leave it stale and the next upsert, computing the key from the *new* userId,
  inserts a second row. `poolJobState` is worse still: its bulk reads go
  through the `UserId` field while its writes upsert on `_id`, so a stale row
  keeps answering queries after a later write has superseded it, and a job can
  read as dismissed after being un-dismissed.

  **Collision rules** — deliberate, and deliberately not reported to the user;
  the reasoning is in "Contested rows change silently" below.
  `poolJobState` takes the union of the two booleans —
  safe because they are independent and both can already be true at once
  (`clear_saved` sets `SavedToTracker` false without touching `Dismissed`), so
  it reaches no state ordinary use cannot. `jobScores` keeps the newer
  `ScoredAt`: a score is a point-in-time opinion computed against a profile, and
  the older one would serve a stale verdict.
- `userQuotas` — **deliberately not merged.** `_id = userId` holding today's
  pack count; merging it would let someone reset their daily allowance by
  signing in. It is a rate limit, not user data.

Shape (a) is the only one a C# architecture test can enumerate, and (c) lives in
Python where reflection cannot see it. A missed collection orphans data
silently, so there are two guards, and the second is the one that matters:

1. **Enumeration** — every `IUserOwned` type must appear in the classification,
   which catches "somebody added a collection".
2. **A post-condition pass** (`FindLeaksAsync`) at the end of every merge,
   asserting nothing still names the retired user **by field or by `_id`
   prefix**, which catches "somebody classified one wrong".

The second exists because the first would have passed on the broken version.
`jobScores` was *handled* — incorrectly — and an enumeration test would have
stayed green while every merge silently created duplicate rows. A classification
test that checks "handled" rather than "handled correctly" is worse than no
test, because it manufactures confidence.

### Contested rows change silently — decided, not overlooked

The notice covers **parked singletons**. It says nothing about the other thing a
merge does: on a contested composite row it **changes data that already
existed**.

- A contested `jobScore` is *overwritten* when the incoming one is newer. In the
  first real run against restored data, an account's score of 61 became 7.
- A contested `poolJobState` is *unioned*, so a flag the account had set to
  false can become true.

Both were verified correct against real data, and neither is reported to anyone.

**Position: acceptable, and deliberately not surfaced.** Both rows describe the
same person, who performed both actions; the newer score is the better answer to
"what is this job worth to me", and the union is the honest reading of "I saved
this" plus "I dismissed this". Reporting it would mean telling someone that
signing in changed numbers they never looked at, which is noise, not
transparency.

**The notice is reserved for parked singletons, and the line is not arbitrary.**
A parked CV is user-authored content that still exists but has become invisible:
not being told means never knowing to look for it. Neither overwrite is in that
class. A `jobScore` is model-derived rather than authored, and the newer one is
better-informed — it was computed against a more recent profile. A union loses
nothing at all; both actions survive.

There is a second cost to reporting them. A banner that announces non-events
teaches the reader to dismiss banners, which weakens the one notice that
actually matters. Spending the user's attention on "a number you never saw is
now a different number" makes "your CV is not the one you just uploaded" easier
to miss.

**The gap worth closing instead: there is no audit trail.** `userMerges` records
how many documents moved per collection, not which ones were contested or what
they held before. So a merge that did something surprising cannot be
reconstructed afterwards. Recording the contested keys (and the losing values)
on the journal costs little, keeps it out of the user's way, and is the thing
that would actually help if someone ever asks why a score changed.

Not built. Revisit before this runs against real anonymous sessions in
production.

### Order

1. **Fast path** — source has no data, skip everything. The common case.
2. **Journal** — insert `userMerges` with `_id = fromUserId`, insert-if-absent.
   The same atomic-claim pattern as `TryLinkAsync`.
3. **(a)** — `updateMany({UserId: from}, {$set: {UserId: to}})`.
4. **(c)** — snake_case field; re-key `poolJobState` row by row.
5. **(b)** — singletons; move when only one side holds one, otherwise the
   signed-in account keeps its own and the anonymous document is parked and
   reported.
6. **Sessions** — `updateMany({UserId: from}, {$set: {UserId: to}})`, repointing
   the user's *other* devices. Only possible because sessions are server-side; a
   self-describing cookie could never be repointed.
7. **Journal completion** — `CompletedAt` and per-collection counts.

### Partial failure: idempotent forward-only, no transaction

The load-bearing property is that `updateMany({UserId: from}, …)` is idempotent
**by construction** — once it runs, nothing matches `from`, so re-running is a
no-op. Partial failure means some steps are done; re-running finishes the job.

Atlas is a replica set and cross-database transactions would work there. We are
not using one, for two reasons:

- **A design that resumes after a process death beats one that only rolls
  back.** An interrupted transaction unwinds; this finishes. An OOM-killed
  process is the realistic failure here, not a logical error.
- The local Mongo container is standalone, so a transaction-dependent path could
  not be tested outside production. A failure path that only exists in
  production is not one to trust.

Worst case mid-flight is a few seconds of a partly-moved account. Nothing is
unrecoverable.

### Idempotent on a double sign-in

Three independent levels:

1. **Journal `_id = fromUserId`**, insert-if-absent — one winner per source
   user; the loser reads the journal rather than racing.
2. **Every operation is idempotent**, so even if both ran they converge.
3. **The fast path** short-circuits the second attempt once the source is empty.

A concurrent second callback whose journal insert fails reads it: if
`CompletedAt` is set, just repoint the session; if not, the other is in flight
and proceeding is safe because of (2). Two sign-ins from *different* anonymous
sessions into the same account are independent merges and compose.

### Orthogonal to `ClaimUserId`

The Phase 1 claim path is unchanged. It is the one-time production migration for
data that predates logins; this is the ongoing case for visitors who start
anonymously.

## Phase 2 — real accounts

Email sign-in, passkeys, additional providers. (Session management moved to Phase 1.5 — it is a prerequisite for public exposure, not a later nicety.) The point of
Phase 1's shape is that this is additive: each new method is one more way to
arrive at a Guid, and nothing below the resolver is touched again.

**Recommended: ASP.NET Core Identity.** Three of the four services are .NET, and
as of **.NET 10** — which every project here already targets — Identity covers
email/password, external providers, 2FA, lockout, email confirmation, and
**passkeys** built in (`PerformPasskeyAttestationAsync`,
`AddOrUpdatePasskeyAsync`, `IdentityPasskeyOptions`). No new service, no new
runtime, and identity stays in the process that already owns `IdentityResolver`.

Known weak spot: Identity's MongoDB store is a third-party package
(`AspNetCore.Identity.MongoDbCore`), not first-party like the EF Core store.
Check its maintenance state before committing — this is the one thing that could
change the recommendation.

### Decision record: why not Better Auth

Better Auth was considered and rejected for this codebase. It is a good library;
it is the wrong shape here.

- It is a **TypeScript** library. A non-JS backend can call its HTTP endpoints or
  verify its JWTs via JWKS, but something must host a Node/Bun process. Prod has
  no JS runtime: client is Vite → static → nginx, API is ASP.NET, scraper is
  Python, mailbot is a .NET console app. It would be a fourth service whose only
  job is sign-in.
- It owns its own `user` / `session` / `account` collections, making it a
  **second source of truth** about who a user is — precisely what the "identity
  resolution is the only code that knows" rule exists to prevent.
- Every auth-aware ASP.NET endpoint would have to validate a Better Auth session
  either over HTTP per request (a network hop on every call) or via JWT.
- .NET 10 Identity closed the passkey gap, which was the main capability argument
  for it.

Its MongoDB adapter (`better-auth/adapters/mongodb`) is first-party and needs no
migrations, so pointing it at the existing Atlas cluster would have been easy.
That was never the obstacle.

**Revisit if** the roadmap grows organisations/teams/invitations, or the frontend
moves to Next.js. Then the ergonomics win and a JS service is justified anyway.

## Google Cloud setup

Two scope sets, deliberately kept apart:

| Purpose | Scopes | Review burden |
|---|---|---|
| Sign-in (this doc) | `openid email profile` | Ordinary consent-screen verification |
| Gmail sync (`docs/mailbot.md`) | `gmail.readonly` | **Restricted** — paid annual CASA security assessment for external users |

Requesting both from the landing page would show a first-time visitor "NextRole
wants to read your email" before they have seen the product, and drag the
restricted-scope assessment in front of a feature that does not need it. Gmail
connect stays a separate, later, opt-in action in Settings.

Note the existing constraint from `docs/mailbot.md`: an app left in *Testing*
status is capped at 100 users and its refresh tokens expire after 7 days.

Branding: "Sign in with Google" is a trademarked button with prescribed styling,
wording and assets. The landing-page link is currently a plain text link with the
G mark, which is off-spec and can be flagged during OAuth verification. Either
adopt Google's button or drop the branding and call it "Restore your account"
until the consent screen.

## Checks to add with the code

Per the standing rule that a rule with no check behind it is not a rule:

- **Done** — the collision table and the claim, as `GoogleSignInResolverTests`
  (9 tests). Includes the two that matter most: a consumed claim stays dead
  with `ClaimUserId` still set, and a lost claim race falls back to an ordinary
  sign-in rather than sharing an account.
- **Done** — `ClaimPinTests` and `ClaimExpiryTests`: every partial configuration
  refuses to start, a stranger arriving first gets their own empty account, an
  unverified address cannot take the claim even when it matches, and an expired
  claim is refused both at startup and at runtime.
- **Done** — `uniq_googlesub` is fatal at startup, so the race guard cannot be
  half-present.
- **Still owed (Phase 2)** — a test that the session cookie is rejected when its
  signature is absent or wrong, once the cookie is signed at all.
- **Still owed (Phase 2)** — an `ArchitectureTests` assertion that no repository
  or user-scoped API accepts a user identifier that is not a `Guid`, to keep a
  second identity type from creeping in.

## Open questions

- **Settled** — session format. Opaque token, server-side lookup, scraper reads
  `sessions` from Mongo. See Phase 1.5.
- **Settled** — `NeedsChoice` narrows to singleton-on-both-sides. See Phase 1.6.
- Does signing out clear `uid` entirely (becoming a new anonymous visitor) or
  return to the pre-link anonymous id? The first is simpler and probably right.
  With server-side sessions the question sharpens: sign-out deletes the session,
  and the next request mints a new anonymous one, so "the pre-link anonymous id"
  is only reachable if we deliberately keep it — which is a reason not to.
- Should a contested merge be reported, or at least audited? Current position is
  no to the first and yes to the second — see "Contested rows change silently".
  Not built.
- Account deletion. There is no such path today because there are no accounts;
  once there are, there needs to be one. It now also has to delete sessions and
  the `googleIdentity` link, not just the data — and note that deleting a link
  re-opens the claim's data gate for that userId. That is survivable only
  because `ClaimExpiresAt` closes the hatch on a date regardless; it is exactly
  why the startup check reading `googleIdentity` was rejected.
- Whether an anonymous session should expire sooner than a signed-in one. A
  year is a long life for a token nobody can revoke by signing out, because an
  anonymous visitor never signs out.
