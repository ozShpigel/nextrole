# Authentication

**Status: Phase 1 built, not yet deployed.** Google sign-in works end to end —
`/api/auth/*`, the `googleIdentity` store, the collision rules and the one-shot
claim, verified against a restored copy of real data. Phase 2 (email sign-in,
passkeys, session management) is still design. Nothing here runs in production
yet: `nextrole.cloud` and `private.nextrole.cloud` are unchanged.

## Where this started

In production there is still no authentication, deliberately. A visitor is identified by the `uid`
cookie and nothing else — no login, no password, no recovery, no account. The
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

`Fixed` mode (`private.nextrole.cloud`) has no cookie and one configured user,
so authentication no-ops there exactly as `UseUserIdentityCookie` already does.
The two deployments keep differing by configuration only.

## The session cookie has to change

Today `uid` is an **unsigned bearer token with a one-year expiry**. Anyone who
obtains that Guid has permanent, unrevokable access to the account. That is
documented and accepted right now — it is httpOnly, Secure, SameSite=Lax,
host-only, and there is nothing behind it but your own job list.

The moment accounts exist, it stops being acceptable: an account implies the
ability to sign out, to revoke a session, and to have a stolen value expire.

So `uid` becomes a **signed, server-side session** that resolves to the Guid,
rather than being the Guid. `IdentityResolver.Resolve` gains a session lookup
ahead of the raw-cookie path; its "mint a fresh id" behaviour for a visitor with
no session stays exactly as it is, because an anonymous visitor is still a
first-class case.

**The scraper reads this cookie too** (`app/identity.py`), and it is Python. So
the session format has to be verifiable from both languages — a signed token the
scraper can validate against a shared secret, or a session id it resolves
through the API. An ASP.NET Data Protection–encrypted auth cookie is *not* an
option: the scraper cannot read it. This constraint rules out several otherwise
reasonable designs, so decide it before writing code.

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
| No profile (never uploaded a CV) | Silently adopt A. B owned nothing; nothing is lost. |
| Has a profile | **Ask.** "Continue as *A* (your saved account), or keep this session's data?" |
| B already linked to a *different* Google account | Refuse, and say so. Two accounts are being conflated. |

Silent merge and silent discard both destroy somebody's work. There is no
correct default for the second row, so it is a prompt, not a rule — the resolver
returns `NeedsChoice` and writes nothing. All three rows are asserted in
`GoogleSignInResolverTests`.

### The one-shot claim (`Google:ClaimUserId`)

The pre-auth data on an instance belongs to a userId nobody can prove they own,
because there was never a login. `ClaimUserId` names it: the first Google
account to sign in adopts that userId instead of the empty one their cookie
just minted. It is how `private.nextrole.cloud`'s history moves to
`nextrole.cloud` under a real account.

**It cannot be re-armed by configuration.** The claim is gated on the target
having no `googleIdentity` document — a fact in the database, not a flag. Once
consumed, the branch is dead however `ClaimUserId` is set, which matters
because on a public instance this is the switch that would otherwise hand an
entire job history to whoever signs in next. Nobody goes back to unset a config
line, so the config must not be what protects it.

Two concurrent first sign-ins can both pass that read, so the insert arbitrates:
`TryLinkAsync` is insert-if-absent and the loser falls through to an ordinary
sign-in. That is why `uniq_googlesub` is created in the **fatal** startup block
rather than the best-effort one — see `Program.cs`. Every other index there is
deduplication; this one is half of the guard, and `_id` uniqueness only covers
the other half.

### Demo mode

The auth endpoints are **not** added to the `Program.cs` allowlist, and the
landing-page link is already hidden when `demoMode` is true. A read-only demo
with a fixed persona has nothing to sign into.

## Phase 2 — real accounts

Email sign-in, passkeys, additional providers, session management. The point of
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
- **Done** — `uniq_googlesub` is fatal at startup, so the race guard cannot be
  half-present.
- **Still owed (Phase 2)** — a test that the session cookie is rejected when its
  signature is absent or wrong, once the cookie is signed at all.
- **Still owed (Phase 2)** — an `ArchitectureTests` assertion that no repository
  or user-scoped API accepts a user identifier that is not a `Guid`, to keep a
  second identity type from creeping in.

## Open questions

- Session format both C# and Python can verify (see above) — shared-secret signed
  token, or a lookup through the API?
- Does signing out clear `uid` entirely (becoming a new anonymous visitor) or
  return to the pre-link anonymous id? The first is simpler and probably right.
- Account deletion. There is no such path today because there are no accounts;
  once there are, there needs to be one.
