# Slimming the scraper to a jobspy adapter

The Python service began as a wrapper around one library. It is now the
orchestrator: it owns the pipeline, holds database credentials, resolves
sessions, and calls the API on a user's behalf. Only one of its modules needs
to be Python at all.

This document is the plan to reverse that — to shrink `server/scraper` to a
stateless adapter over jobspy, and to move everything else into .NET, where
the repositories, the models and the user-scoping guard already live.

Nothing here changes behaviour. Every phase is deployable on its own, and the
daily ingest keeps running throughout.

## The measurement

```
server/scraper — 4,907 LOC
├──   333  app/services/scraper.py   ← the only module that imports jobspy  (6.8%)
└── 4,574  orchestration, HTTP, Mongo, identity                            (93.2%)
```

Ten modules touch Mongo, three speak HTTP, two serve FastAPI. Exactly one
needs the Python runtime.

## Target architecture

```
┌─ server/listings (Python, ~430 LOC) ───────────────────────────┐
│  Stateless. No Mongo. No identity. No API calls.               │
│                                                                │
│  POST /scrape      {roles[], locations[], site_names[],        │
│                     results_wanted, hours_old, country}        │
│                 →  {jobs: [...normalized...], stats: {...}}    │
│  POST /scrape/url  {url} → {job} | null                        │
│  GET  /health                                                  │
└────────────────────────────────────────────────────────────────┘
          ▲ HTTP — no credentials, it holds nothing worth stealing
          │
┌─────────┴──────────────────────────────────────────────────────┐
│  server/api/src/                                               │
│  ├─ PoolIngest/   console app, cron container — owns the flow  │
│  └─ Api/          per-user pool state, UserScopedCollection    │
└────────────────────────────────────────────────────────────────┘
```

### Why `PoolIngest` is a project and not a service

`server/mailbot/Mailbot.csproj` has **zero `ProjectReference`s** — it reaches
the API entirely over HTTP. That independence is why it lives outside
`server/api`. `PoolIngest` is the opposite: it exists in .NET precisely to use
`IPoolJobRepository`, `PoolJob` and the Mongo layer directly, so it belongs
beside `DbCopy` and `Seeder` in `server/api/src/`, which are console apps on
the same footing.

A `BackgroundService` inside the API was considered and rejected: a
Claude-heavy batch would compete with the manual scoring page for the very
resources the `match`/`discovery` rate-limit split protects; `restart:
unless-stopped` would make every container recreate a run; a crash would take
the API down with it; and two API instances would double-run it.

### Where each module lands

| Module | LOC | Fate |
|---|---|---|
| `services/scraper.py` | 333 | **stays** — jobspy, NaN handling, `is_remote` correction |
| `services/orchestrator.py` | 653 | **delete** — the legacy criteria path |
| glassdoor + news + company_size + ddg_search | 408 | **delete** — 5.6% hit rate, see Decisions |
| `services/demo_seed.py` | 275 | **delete** — the demo was torn down |
| `models/search_criteria.py`, `schemas/criteria.py` | 73 | **delete** |
| `services/pool.py` | 377 | → `PoolIngest` |
| `main.py` — pool state + jobs list | ~535 | → `Api` endpoints |
| `services/pool_state.py` | 113 | → `IPoolJobStateRepository`, user-scoped |
| `services/match_client.py` | 322 | **evaporates** — same process as the caller |
| `services/tracker_client.py` | 246 | **evaporates** — same process |
| `identity.py` | 186 | **evaporates** — the API is the only resolver again |
| `indexes.py` | 268 | → `PoolIndexInitializer` |
| `roles.py` | 169 | → `PoolRoleService` (already exists in .NET) |
| `services/parse_quality.py`, `models/` | 275 | → `Core/Matching` |
| `services/verdict_eval.py`, `subscore_eval.py` | 362 | → a .NET console tool, Phase 2 |

## Phases

Each phase ends at a deployable state. Merging to `main` is the deploy, so
none of them may be half-landed.

### Phase 0 — delete, do not port

Roughly 1,400 LOC would otherwise be migrated for nothing. Nothing else starts
before this.

- Remove `orchestrator.run_discovery` and its helpers.
- Remove the criteria CRUD endpoints, `trigger_run`, `get_run_jobs`, and the
  `run` / `run-all` CLI subcommands. The client calls none of them — it only
  uses `/jobs`, `/jobs/{id}/save|view|dismiss`, `/jobs/unsave`, `/jobs/import`.
- Remove `demo_seed.py` and its two CLI subcommands.
- Remove `search_criteria` handling: the model, the schemas, the `indexes.py`
  backfill, and the `UserMergeService.SnakeCaseOwned` entry.
- Keep the `SearchCriteria` class only if `pool.py:115` still needs it as the
  DTO it passes to `scrape_for_criteria`; rename it to reflect that
  (`ScrapeSpec`), since it no longer describes a user-owned document.

**Not touched:** any document in Atlas. The 3,328 orphan pool rows and the
1,835 stale `score` fields stay where they are — they are invisible to every
scan already (no `pool_key`).

And the orphans need no cleanup at all: every one of them carries
`ttl_managed: true`, so the 60-day TTL index deletes them on its own. Only the
pool rows opt out of retention. That leaves the data cleanup with just
`search_criteria` (3 documents) and, optionally, `$unset` of the stale score
and snapshot fields to reclaim space — a much smaller job than it first looked,
and one with no irreversible bulk delete in it.

Before that cleanup runs, **`server/api/src/Seeder/Program.cs:587` must stop
writing `search_criteria`** — it still creates a criteria document and tags
seeded jobs with its `criteria_id`, so a reseed would recreate the collection
after it is dropped. The seeded document also carries no `user_id`, which the
scraper's startup used to stamp and no longer does, so it is invisible to the
`UserMergeService.SnakeCaseOwned` re-key that this phase deliberately kept.

**Verify:** `python -m app.cli run-pool` completes; `GET :8000/openapi.json`
no longer lists the criteria routes; the Matches page is unchanged.

### Phase 1 — per-user pool state → the API

`save` / `dismiss` / `view` / `unsave` and the jobs list are user-scoped
request/response endpoints of exactly the shape the API already serves.

- New `IPoolJobStateRepository` over `poolJobState`, on
  `UserScopedCollection<T>` — which has no overload that omits the userId, so
  the scoping becomes a compile error rather than a convention. This closes
  the gap that let `orchestrator.py:149` look a document up with no user
  filter.
- New endpoints in `Api`, mirroring the current paths so the client change is
  a base-URL swap: `client/src/lib/api.ts` `discoveryApi` → `api`, six call
  sites, all under `lib/`.
- Add the routes to `client/nginx.conf`. The catch-all JSON 404 is what makes
  a missed one announce itself — do not remove it.
- Extend `ArchitectureTests` to cover the new repository.

**Verify:** `curl -s -o /dev/null -w '%{http_code} %{content_type}\n'` on each
new route — `200 application/json`, never `200 text/html`. Take the baseline
*before* deploying.

### Phase 2 — the ingest → `PoolIngest`

```
server/api/
├── Dockerfile              → ApplicationTracker.Api.dll   (image: api)
├── Dockerfile.poolingest   → PoolIngest.dll               (image: pool-ingest)
└── src/PoolIngest/
```

The flow it owns:

```
PoolIngest
  ├─ HTTP  → listings   POST /scrape          raw jobs
  ├─ Mongo → pool_key dedupe, upsert, age-out (shared pool, no userId)
  ├─ HTTP  → api        /api/match/job-facts, /api/match/job-parse
  └─ Mongo → pool_roles
```

**Claude calls go over HTTP to the API** — decided, not merely preferred. It
follows the mailbot, which could reference `Core` and deliberately does not:
one copy of the prompt config, one Anthropic key, one set of rate-limit
buckets, and `AGENTS.md`'s "all Claude calls live in the API" stays literally
true. The usual hazard of an HTTP boundary does not apply here — **every
Claude call the ingest makes is user-independent**, which is exactly the set
that passes an explicit `None` identity today. `PoolIngest` presents
`X-Api-Key` and `X-Source`, and needs no session token, because it acts as
nobody.

`IPoolJobRepository` is documented as read-only from the API's side. Phase 2
gives the pool a write path; keep it on a separate interface
(`IPoolJobWriter`) so the API's read-only contract stays honest.

CI: **extend `api.yml` to build and push both images in one job.** Two
workflows on the same `server/api/**` filter could deploy an API on new `Core`
while `pool-ingest` still runs the old one — invisible skew, in a repo where
merging is deploying.

Compose, one service changes:

```yaml
pool-ingest:
  image: ghcr.io/ozshpigel/pool-ingest:latest    # was scraper:latest
  command: dotnet PoolIngest.dll                 # was python -m app.cli run-pool
  profiles: ["cron"]
  env_file: [.env.pool-ingest]                   # new: Mongo + API base url
```

`deploy/systemd/nextrole-pool-ingest.service` is untouched — it runs the
service by name, and `ExecStartPost=daily-digest.sh` stays attached.

**Verify:** run it once by hand (`docker compose --profile cron run --rm
pool-ingest`) and compare the run record and inserted count against the last
Python run before trusting the timer.

### Phase 3 — strip

Python keeps `services/scraper.py`, a thin `main.py`, `config.py`. Delete
`identity.py`, `indexes.py`, `roles.py`, `match_client.py`,
`tracker_client.py`, `pool.py`, `pool_state.py`, the models, the CLI.

`.env.scraper` loses `MONGODB_CONNECTION_STRING` entirely. A service that
parses hostile HTML stops holding `readWrite` on both production databases.

`tests/test_identity_forwarding.py` becomes obsolete — there is nothing left
to forward. Delete it *with* the code it guards, not before.

### Phase 4 — rename

Only once the service is ~430 LOC and its config surface is at its smallest.
Renaming a 4,900-LOC service you are about to gut means paying twice.

The blast radius today: client 10 files, server/api 30, docs 13, deploy 7,
.github 3, e2e 2 — plus three that are not mechanical:

- **`.env.web` on the box.** `SCRAPER_URL` is a Docker DNS service name
  resolved at runtime by `client/nginx.conf`. Manual config; no `git pull`
  fixes it.
- **`ghcr.io/ozshpigel/scraper:latest`.** A new image name means the first
  deploy pulls something that does not exist yet and compose keeps the old
  container. Merge the workflow before the compose change.
- **`daily-digest.sh`'s Loki filters**, which key on service labels.

## Decisions

**Settled: `PoolIngest` reaches Claude through the API over HTTP.** See Phase 2.

**Settled: the eval CLIs move to a .NET console tool.** `verdict_eval` and
`subscore_eval` become a project alongside `PoolIngest`, reading the same
golden-set fixtures. They stay Python until then, because Phase 0 through 2 do
not remove what they depend on.

**Settled: the Python service is renamed `listings`,** in Phase 4. `digest` was
considered and rejected — it already names the daily Telegram digest
(`deploy/monitoring/daily-digest.sh`), which reports *on* this pipeline.

**Settled: the enrichment clients are deleted.** `glassdoor_client`,
`news_client`, `company_size_client` and `ddg_search`, with their tests. Two
measurements decided it against restoring Glassdoor in .NET.

**It succeeded 5.6% of the time.** Across the criteria path's whole life the
DDG-then-Glassdoor scrape produced data for **49 of 875 distinct companies** —
the same 5.6% per job. Porting HTML parsing of a site that actively blocks
scrapers, reached through a search-engine redirect, to win data on 1 job in 18,
is not a good trade for a fresh service.

**And its absence is the safe direction, not a lost guard.** `ReviewCap(null)`
is **1**, the tightest setting; review evidence *loosens* the clamp to 2 or 3 on
Engineering Maturity, Pace & Workload and Long-term Risk. So removing Glassdoor
makes scoring more conservative. An earlier reading of this had it backwards —
the mechanism is a permission bought by evidence, not a protection lost without
it.

What stays: `ReviewCap` and `EnforceReviewCaps`, which are correct with null
input and are the enforcement half of PR #1's lesson (a structured field plus a
server-side clamp, because the model will not respect a prompt-stated cap).
`PoolScanService` still forwards `GlassdoorData`, because the ~24 pool-visible
documents from the criteria era carry real values until they age out.

`DiscoveredJob` drops `company_news` and `glassdoor_data` outright rather than
keeping nullable fields — a field nothing can ever write reads as an oversight
to the next person. Documents already holding them are untouched and still
forward what they have on save.

If employee-review signal is ever wanted again, the answer is a paid API with a
contract, not scraping at 5.6%. Recorded here so the gap looks like a decision
rather than an omission.

**Open — `server/api/` as a directory name.** With five projects under it, it
is the .NET solution rather than the API. `server/dotnet/` would be truer.
Lower priority than the Python rename, same reasoning.

## Phase 0 as built

Two things went differently from the plan above, both deliberately.

**`UserMergeService.SnakeCaseOwned` was left alone.** The plan said to remove
the `search_criteria` entry; that would have left three documents in the
database that a merge no longer re-keys, and dropped the post-condition leak
check that asserts none survive a merge. Code that handles data still present
should outlive the code that wrote it. It goes with the collection, in the
data cleanup.

**`DiscoveredJob` keeps its now-writerless fields.** `company_news`,
`glassdoor_data`, `score`, `verdict`, `should_apply`, `match_analysis` and the
four snapshot fields have no writer left in the scraper. Removing them would
make new pool documents differ in shape from the 3,542 existing ones while the
Glassdoor decision is still open, so they stay.

Delivered: 1,341 lines deleted, 26 added, across 14 files; 93 tests pass. The
routes that survive are exactly the seven the client calls, plus the two
read-only run-history ones and health.

One thing found while deleting, not fixed — `pool_key` hashes `date_posted`
when a listing has no `job_url`, so jobspy's intermittently-null date
extraction would split one listing into two pool rows. Rare on LinkedIn, where
a URL is always present. The orchestrator's `_backfill_date_posted` guarded the
adjacent problem (a null re-scrape overwriting a stored date) and was safe to
delete, because the pool's touch branch never writes `date_posted` at all.

## What this fixes on the way

- **The identity-forwarding bug class disappears.** `AGENTS.md` records it
  shipping twice, and `tests/test_identity_forwarding.py` exists only to walk
  the AST hunting for call sites that forget. One process, nothing to forward.
- **User scoping becomes structural on the pool paths.** `UserScopedCollection`
  reaches code the Python service could only cover by convention.
- **The scraper stops holding database credentials.**
- **One less Mongo driver, session resolver and config schema** to keep in
  step across a deploy — most of the `.env.api` / `.env.scraper` divergence
  risk goes away.
- **Two duplicate pipelines become one.** Phase 0 ends the split where the
  legacy path scored at ingest and the pool path deliberately does not.

## Things that must not get lost

`services/scraper.py` holds hard-won jobspy knowledge: the `is_remote`
correction for LinkedIn's naive substring heuristic, the DataFrame/NaN
handling, and the private `jobspy.linkedin.util` imports behind
`fetch_job_by_url`. That logic stays Python-side and must not be
half-translated. The `/scrape` contract returns jobs **already normalized**,
exactly as `scrape_for_criteria` does today.

`nextrole.sln` is stale — its paths point at `API\src\...`, which does not
exist, and only `Mailbot` resolves; `DbCopy` and `Seeder` were never added.
Adding `PoolIngest` is the moment to repair it, or to delete it if projects
are built by path anyway.
