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

`save` / `dismiss` / `view` / `unsave` are user-scoped request/response
endpoints of exactly the shape the API already serves. **Done**, except the
jobs list — see Phase 1b.

- `PoolJobState` + `IPoolJobStateRepository` over `poolJobState`, on
  `UserScopedCollection<T>`, which has no overload that omits the userId. The
  field names are copied from `pool_state.py`, not designed: the documents
  already exist and the two services shared them during the move.
- `UserScopedCollection.UpdateManyAsync` added. `ClearSaved` needs a bulk write
  and the absence of that overload would have been the excuse to reach for a
  raw handle — there isn't one, by design, so the overload is the fix.
- `ApplicationCreation` extracted. "Add to tracker" used to be an HTTP POST to
  `/api/applications`, so the three-step create sequence was shared by
  construction; in-process it needs a shared function or it drifts.
- `PoolJobApplication.ToApplication` is a pure mapper, so the join that has
  already gone wrong once (reading the score off the pool document instead of
  `jobScores`) stays pinned. `PoolJobApplicationTests` ports the scraper's
  `test_save_job_score.py`, minus its userId-filter assertion — that one became
  a compile error, which is the better version of it.

**Paths are `/api/pool/*`, not the old `/api/discovery/jobs/*`.** nginx sends
`/api/discovery` to the scraper as one prefix block. Keeping the paths would
have meant splitting a single prefix across two upstreams by sub-path: it
works, since prefix locations match by length, but it puts the routing of a
user's writes one typo away from the catch-all. `nginx-routes.test.ts` now
asserts the `/api/pool` block exists *and* points at `$upstream_api`.

`UserMergeServiceTests.Every_user_owned_type_is_classified` failed the moment
`PoolJobState` appeared, demanding its collection be placed in the merge
classification. That is the guard working: an unclassified `IUserOwned` type is
data orphaned on every sign-in, silently.

### Phase 1b — the jobs list

`GET /api/pool/jobs`, the Matches page's only data source. **Done.**

- `PoolBrowseService` owns the join. Three collections meet, and which one
  leads matters: `jobScores` decides eligibility, because a pool job with no
  row for this user has never been scored for them. The pool document then says
  what the posting is, and `poolJobState` what this user did about it.
- The merge stays in memory rather than becoming a `$lookup`, for the reason
  the Python had: the sort key lives in the joined collection, so a pipeline
  would have to sort after the lookup anyway, and a user has at most a few
  hundred scored rows.
- Browse got its own projection (`PoolJobListItem`) instead of widening
  `PoolJob`, which is deliberately thin because every scan carries it.

**The wire contract is byte-identical, snake_case and all.** The client reads
`saved_to_tracker`, `match_analysis`, `actual_job_level` and the rest, so the
response keeps those names via `[JsonPropertyName]`. Renaming in the same
change would make any regression ambiguous, and the dangerous ones are silent:
a missing `saved_to_tracker` reads as `undefined`, which is falsy, so a saved
job would quietly render as unsaved. Normalising to camelCase with the client
is worth doing as its own change.

Typing the response is already an improvement regardless. The scraper returned
the raw Mongo document with `_id` stripped, so the wire contract was "whatever
fields `discovered_jobs` happens to have" and any storage change leaked
straight to the browser.

What is left on the scraper: `POST /api/discovery/jobs/import` (calls jobspy,
so Phase 3), the two read-only run-history endpoints, and health.

### Phase 2 — the ingest → `PoolIngest`

**Done.** `server/api/src/PoolIngest`, a console project beside `DbCopy` and
`Seeder`, built into its own image by `api.yml` and run by the existing cron
container.

```
PoolIngest
  ├─ HTTP  → scraper   POST /scrape          raw listings
  ├─ Mongo → pool_key dedupe, upsert, age-out (shared pool, no userId)
  ├─ HTTP  → api        /api/match/job-facts, /api/match/job-parse
  └─ Mongo → pool_roles (read), discovery_runs (write)
```

Claude stays behind the API, following the mailbot — which could reference
`Core` and deliberately does not. One prompt config, one Anthropic key, one set
of rate-limit buckets. The usual hazard of an HTTP boundary does not apply:
every call the ingest makes is user-independent, so it presents `X-Api-Key` and
`X-Source` and **no session token**. It acts as nobody.

**`pool_key` was the risk, and it is pinned by fixtures generated from the
Python itself** rather than from reading it. It is a unique index over ~3,700
documents: a key that differs by one character makes the whole pool look new,
so one run would insert a duplicate of every listing, extract facts for all of
them at a Claude call each, and start ageing out the real rows. `PoolKeyTests`
asserts the exact strings, including the NUL separator, the 32-char truncation,
Hebrew inputs, and the one known `casefold`/`ToLowerInvariant` divergence,
which is asserted as a difference so it stays visible.

**`HttpClient`'s 100-second default would have aborted every run.** A scrape of
a dozen roles paces 8–20s between searches and runs for minutes. No proxy sits
in this path — it is Docker DNS, container to container — so the timeout set in
`Program.cs` is the only limit that applies. It is 30 minutes, with the reason
written next to it.

The document builder writes `BsonDocument` rather than mapping a typed model,
deliberately: the field names and their casing are history the API already
reads, and a typed model invites tidying that history into a silent divergence.

`roles.json` ships **inside** the image with an env override, as it did in the
scraper's, rather than being mounted. Baking a default means the box needs no
hand-placed file — manual state on the box is what no `git pull` fixes, and
`.env.web` is the standing lesson.

`nextrole.sln` was rebuilt while adding the project. It had been stale: its
paths pointed at `API\src\...`, which does not exist, so only `Mailbot`
resolved and `DbCopy`/`Seeder` were never in it. All nine projects now build
from the solution.

**The Python `run-pool` is deliberately left in place** as a fallback for the
first few nights. Nothing invokes it — the compose service runs the .NET image
— and Phase 3 removes it.

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

**Settled: `server/api/` keeps its name.** It holds five projects and only one of them is the API, so the directory is named after a child rather than the whole — but renaming it would touch every Dockerfile, workflow path filter and doc reference to buy nothing a reader is actually confused by. Recorded as decided so it stops reading as an open item.

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
