# NextRole — Agent Guide

NextRole is a multi-user job application platform that automates the job hunt end-to-end: a daily run discovers listings into one shared job pool and reads what each posting asks for once, each user's own scoring happens on demand when they open Matches, Gmail is monitored for application updates, and everything — discovery through interviews — is tracked in one dashboard. See `project-scope.md` and `implementation-plan.md` for full detail.

## Stack & structure

| Path | What |
|---|---|
| `/client` | React + Vite + shadcn/ui + Tailwind v4 (TypeScript, Bun) |
| `/server/api` | ASP.NET Core (C#) — **all Claude/Anthropic calls live here** |
| `/server/scraper` | Python FastAPI — scraping, dedupe, per-job fact extraction. Never scores, never reads a profile |
| `/server/mailbot` | .NET console app — one-shot Gmail sync (cron), not a service |
| `/server/api/src/DbCopy` | CLI: copy a database (documents + index definitions) to a scratch name, for rehearsing a migration against real data |

Database: MongoDB Atlas.

## Running locally

```bash
cd client && bun run dev # Vite on :5173
cd server/api/src/Api && dotnet run # ASP.NET Core on :5002
```

```powershell
# Scraper — Python FastAPI on :8000 (PowerShell for venv activation)
cd server/scraper
.\.venv\Scripts\python.exe -m uvicorn app.main:app `
  --host 0.0.0.0 --port 8000 --reload
```

## Hard conventions

- Frontend: TypeScript everywhere; **Bun** (not npm/yarn); shadcn/ui components (`@/components/ui/*`); **Axios** (not fetch); **TanStack React Query** for server state (not useEffect + useState).
- **Never hardcode Tailwind palette colors** (emerald/amber/red…). Use design tokens: `--ed-*` inside editorial pages, shadcn semantic tokens in neutral/shared chrome (nav, portaled dialogs). Theme spec + portal caveat: `docs/design-system.md`.
- The frontend is English LTR, but content can be mixed Hebrew RTL (AI summaries, interview text) — render those nodes with `dir="rtl"`/`dir="auto"`.
- **Never fire a mutation from a mount effect without a ref guard.** StrictMode invokes effects twice in dev, and a `let cancelled` cleanup flag does NOT stop an awaited mutation — it only suppresses the `setState`, so the request completes twice. This has bitten twice, most expensively the CV upload: two Claude PDF reads and two profile saves per upload (`uploadedRef` in `ProcessingPage.tsx`). Guard with a ref, or prefer a query or an event handler. The one exception is an idempotent write with no AI cost — say so in a comment when you rely on it.
- All Claude/Anthropic calls live in the API; the scraper delegates via HTTP.
- AI prompts use system/user separation: trusted instructions in the system prompt; untrusted external data (job descriptions, emails, scraped titles) XML-wrapped in the user message.
- **A check whose input the model writes is not a check.** `stackedGaps` was the Evaluator's own list of missing requirements, and it was the only input to the Core Stack cap — so the responses that needed capping reported the gaps away (12 absent requirements, 1 self-reported gap, 20/20). Compute the consequence's input server-side from data the model does not author: the posting's extracted `must_have_tech` and the profile (`ClaimGrounding`). Same lesson as `reviewAdjustment`, one level deeper.
- **Claims about the candidate must trace to the profile.** The prompt constrained what the Evaluator may call MISSING and said nothing about what it may call THEIRS, so it read postings' requirement lists back as the candidate's stack. Any generated text naming a technology as the candidate's is checked against their profile (`ClaimGrounding` for scores, `ResumePackValidator` for packs, both via `ProfileTrace`). Scores annotate (`UnsupportedClaims`); packs block — a pack goes to an employer. Detail: `docs/scoring-and-search.md`.
- **A prompt rule with no code check behind it is not a rule.** Models ignore prose constraints silently and indefinitely — the résumé pack shipped 53 generations breaching rules its own prompt stated. When adding a rule, add the check with it, or record in the code that it's knowingly unchecked and why. Don't invent a check that only appears to verify something: a weak proxy is worse than an honest gap, and a check that blocks must be exact and measured against real output first (`docs/resume-pack.md`, `ResumePackValidator`).
- **The `claude-*-5` models need `AnthropicThinkingHandler`.** They run *adaptive* thinking by default with no cap, which will consume the entire `max_tokens` budget before emitting a single output token — the response then carries a `thinking` block and no `text` block at all, and the caller sees an empty completion. The handler stamps `thinking: adaptive` + `output_config: effort` onto outgoing requests for those models; the SDK cannot express this (`ThinkingParameters.Type` is a get-only `"enabled"`, which these models reject with a 400). They also reject an explicit `temperature`, so `ScoringConfig.Temperature` is dropped for them at request time.
- `scoring_config` + the agent prompts are **read-only server configuration** (Options pattern, env overrides, change = redeploy). The candidate **profile is the user-editable input** — stored as `StructuredProfile`, rendered to the `content` string prompts consume; **never hand-edit `content`**. Keep prompts generic/objective; candidate signal comes only from the injected profile. Detail: `docs/scoring-and-search.md`.
- **Every user-scoped query takes an explicit `userId`.** Repositories never see a raw `IMongoCollection<T>` — they get `UserScopedCollection<T>`, which has no overload that omits the userId, ANDs the filter on internally, and exposes no way back to the raw handle — so "remember to scope it" is a compile error rather than a convention (`ArchitectureTests` guards the rest). `_id = userId` for one-per-user documents (profile, resumeFile, interviewInsights); a `UserId` field + index for the rest. The job pool (`discovered_jobs`, `discovery_runs`) is shared. Detail: `docs/multi-user.md`.
- **Identity resolution is the only code that knows which deployment it is.** `Identity:Mode` is `Fixed` (id from config) or `Cookie` (id from the opaque session token in the `uid` cookie; the API is the only issuer). Everything downstream takes a plain `Guid`. **The two differ by configuration only — never by a code branch or a duplicated service.** If you reach for `if (private)`, the resolution layer is the thing to change. Misconfiguration fails at startup.
- **A service client must present the session token, not the userId.** The API answers an identity it cannot resolve by *minting a fresh user*: the write returns 201 and lands where nobody will find it. Shipped twice from the scraper, once from the mailbot (#67 — 115 applications, 0 seen, `{"Success":true}`). The scraper now presents nothing at all, so the mailbot is the only client this still binds; the rule above is what guards it server-side.
- **An unresolvable credential from a service client is a 401, never a new account.** Minting is right for a browser and catastrophic for a daemon, which only reaches that state by being misconfigured — that conflation caused all three orphaned-write incidents. The refusal fires when the **handler asks who the user is**, not in middleware: refusing up front also refused the user-independent calls, and the ingest silently stored 60 jobs with no requirements. Detail: `ServiceIdentityRefusalTests`.
- **A shared pool document holds only what is true for everyone.** Apply the test: would two users ever disagree about this field? Then it belongs in a per-user row — `jobScores` for the score, `poolJobState` for dismissed/saved (`IPoolJobStateRepository`) — never on `discovered_jobs`.
- **The job pool is shared, and the daily ingest is config-driven.** `server/api/src/PoolIngest/config/roles.json` drives the `pool-ingest` cron container — not anyone's profile or saved search. A listing is identified by `pool_key` (unique index), marked inactive after N absent runs and **never deleted**, and has its stated requirements extracted exactly once on entry. The role list is that file's human-authored baseline (always searched, never dropped) plus roles grown from users' CVs in `pool_roles`, which leave again when their last user does; `max_roles` caps the total. Detail: `docs/job-pool.md`.
- **Nothing is scored at ingest.** The pool is shared, a score is an opinion about one candidate, so scoring is per user and on demand: `POST /api/match/pool-scan` narrows the pool with a cheap Mongo filter over the extracted facts, scores only what that user has never had scored, and stores it in `jobScores`. Per-user allowances (3 packs/day) are claimed atomically before the Claude call, never counted afterwards. Detail: `docs/scoring-and-search.md`.
- **Multi-user, still no authentication (intentional).** A visitor is identified by the `uid` cookie and nothing else: no login, no recovery, no account. That is a deliberate trade for a personal-scale tool, and it is why the userId rule above has to be structural rather than diligent — there is no auth layer standing behind it. **Optional Google sign-in is live on `nextrole.cloud`** and anonymous use still needs no account: the Guid stays the identity and auth only decides *which* Guid you are (`docs/auth.md`). The `uid` cookie carries an opaque session token, not a userId — presenting a userId gets you an empty account. Detail: `docs/multi-user.md`.
- Use the context7 MCP server to fetch up-to-date library documentation.

## Working agreement

When two instructions conflict, stop and ask — don't pick one silently.

## UI rules

NextRole is a scanning tool, not a reading surface. The match score
carries the visual weight; typography stays quiet.

- Dark is the only theme. Don't add a light mode or a theme toggle.
- Mostly flat. Real bordered/panel cards get the soft elevation shadow the `.editorial` "modern-skin layer" already applies automatically (`client/src/index.css`) — don't hand-roll a heavier one. Exception: `.editorial-grain`/`.home-atmosphere` are intentional ambient layers on Landing/Home. Everywhere else: no gradients, no glow.
- Use tokens from `client/src/index.css` only. Never hardcode hex.
- `--ed-accent` marks the primary action, or active/selected state, wherever that state appears. Never decorative.
- The score ramp is never used for accent, status, or category.
- The score ramp is for any 0-100 or rated score (match score, interview score, per-dimension sub-scores). Never for status or category.
- Error and destructive states keep their color (`--ed-no`). Everything else that isn't a primary action or a score stays neutral.
- Two font weights: 400, 500.
- Display face (`--font-serif`, Schibsted Grotesk) is for the wordmark and empty-state copy only. Page titles and section headers use sans with weight.
- Type scale: 40 / 16 / 13. No other sizes.
- RTL: mixed Hebrew content (AI summaries, interview text) gets `dir="rtl"`/`dir="auto"` on those nodes — see `docs/design-system.md`. Physical `pl-`/`pr-`/`ml-`/`mr-` elsewhere, not logical properties.

## Feature docs (read when working in that area)

| Area | Doc |
|---|---|
| Scoring pipeline, title triage, company enrichment, on-demand AI (superseded in part by the shared pool) | `docs/scoring-and-search.md` |
| Shared job pool, dedupe, fact extraction, role growth, measured size | `docs/job-pool.md` |
| Multi-user: identity modes, userId scoping, per-user scoring and quotas | `docs/multi-user.md` |
| Auth: sign-in, sessions, the anonymous-session merge, the one-shot claim | `docs/auth.md` |
| Editorial Broadsheet theme (tokens, page pattern, portal caveat, status colors) | `docs/design-system.md` |
| Tracker list projection + Applications tab buckets | `docs/tracker.md` |
| Generate Pack — AI-tailored résumé PDF per application | `docs/resume-pack.md` |
| Interview prep, Q&A rubric, keyword cues, mock interview | `docs/interview-prep.md` |
| Mailbot (Gmail sync, parsing rules, resync, OAuth) | `docs/mailbot.md` |
| Hosting: least-privilege Atlas credentials, the ApiKey gate, seeded fictional data | `docs/hosting.md` |
| Deploying: the box, config, verification probes, what a green tick misses | `docs/deploying.md` |

## Testing

- **Unit/component**: Vitest + Testing Library (`cd client && bunx vitest run`). Tests query by text/role/testid — preserve those when restyling. Editorial restyles must keep heading roles (e.g. `AnalysisCard`'s "AI Analysis" stays an `<h3>`, asserted by an e2e `getByRole('heading')`).
- **Architecture**: xUnit in `server/api/tests/ArchitectureTests` (`dotnet test server/api/tests/ArchitectureTests -c Release`). Asserts user-scoping cannot be bypassed. Use `-c Release` if a dev API server is holding the Debug output lock.
- **E2E**: Playwright in `/e2e` (`npx playwright test`, use `--reporter=line` to avoid the HTML report server hanging). Use the `e2e-test-writer` agent to **write** tests — it has the full setup, DB config, and conventions.
- **Confirm a database name is free before seeding into it.** `list_database_names()` first, and refuse if the target exists — a "scratch" name that turns out to be a real database means the seeder writes into live data. The seeder deletes and reinserts per seed user, so the blast radius is not bounded by anything except which database it was pointed at. (Cost so far: two documents written into the real demo DB, caught only because a legacy unique index happened to abort the run.)
- **Running e2e locally — stop your dev servers first.** Playwright's `webServer` config sets `reuseExistingServer` when not CI, so if your dev servers are up on :5002/:8000/:5173 it runs the suite against them (your dev `job-tracker` DB) instead of spawning its own against the **test** DBs (`job-tracker-test`/`jobmatch-test`, which `global-setup` drops). Gotcha: a uvicorn `--reload` reloader can survive a task kill and hold :8000 in *Bound* (not *Listen*) state — a `-State Listen` port check won't see it; find/kill the python PID directly.
- **After a "restart", verify the process actually runs the new code** — both dev servers have survived intended restarts (day-old PIDs kept serving :8000/:5002, silently executing old code). Cheap probes: scraper → `GET :8000/openapi.json` should list the endpoint you're testing; API → hit the endpoint with `{}` — a **404** where you expect a **400** means the old build. If stale, `Get-NetTCPConnection -LocalPort <port>` → `taskkill /PID <pid> /T /F`, then relaunch.
- **Check which path your instrument exercises before trusting a clean result.** A clean result from an instrument that cannot see the change is worse than no result, because it licenses the change. Twice now: a company-news A/B that came back 0 in both arms because the batch prompt drops that field regardless of input, and a plan to golden-set a change to `components[].reason` when the evals drive the **single-job** path and the cap lives in the **batch** addendum. Before running an eval to justify a change, name the path the change lives on and confirm the eval drives it.
- **Score drift cannot detect the loss of a guard.** The sharpest case of the above. Dropping `components[].reason` would have removed **72% of all `UnsupportedClaims` catches** (48 of 67, measured across every stored production score) — and moved no score at all, because `ClaimGrounding` annotates rather than scores. A golden-set run would have come back clean and been reported as safe. When removing a field, grep for who *reads* it server-side before measuring what changes when it is gone; "nothing renders it" is not "nothing uses it".
- **Hebrew in PowerShell 5.1 looks like mojibake (`××ª×...`) — it's the console, not the data.** `Invoke-RestMethod` decodes JSON responses without a charset header as ISO-8859-1. The wire bytes are valid UTF-8 (the browser renders fine); recover a captured string with `s.encode('latin-1').decode('utf-8')` if you need to read it in a script.

## Deploying

- **Merging to `main` IS the deploy.** Every workflow in `.github/workflows/`
  ends by SSHing to the VPS. There is no separate step to forget and no way to
  merge without shipping. Images are `:latest` from `main` only, so a branch's
  images do not exist.
- **`deploy/` is not synced by CI.** `compose.yml`, the systemd units and the
  monitoring configs are manual state on the box that no `git pull` fixes. This
  has bitten twice — most recently a "Phase 2" run that was actually the old
  Python ingest, because the new service definition never reached the server.
- **Config changes are where the danger is.** `.env.api` and `.env.pool-ingest`
  share a credential and must move together; `.env.web` holds Docker DNS service
  names resolved at runtime by `client/nginx.conf`.

Everything else — verification probes, the Atlas credential scope, the mailbot's
session token, what a green tick does not cover — is in **`docs/deploying.md`**.
Read it before touching the server.

## Security

- CORS defaults to restrictive (empty) — set `CorsOrigins` env var explicitly
- Rate-limit buckets (`Program.cs`): `match` (10/min — manual "Score a Job" page, normalize, interview-prep cues) and `discovery` (20/min — the batch endpoints a run or a scan drives, including `/api/match/pool-scan` and the legacy `/api/match/discovery-score-batch`, kept separate so a big scan never starves the manual page). 50K char max on job descriptions.
- Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` headers
