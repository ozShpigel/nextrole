# The shared job pool

One pool, everyone. The daily ingest is not driven by anyone's profile or saved
search: it scrapes a fixed role list, folds the results into a single shared
collection, and records what each posting asks for. Per-user work — deciding
which of those jobs are worth scoring, and scoring them — happens later, on
demand (Step 5).

`discovered_jobs` and `discovery_runs` are shared; nothing in this document is
user-scoped. See `docs/multi-user.md` for everything that is.

## The role list is configuration

`server/scraper/config/roles.json`, not code. Point `ROLES_CONFIG_PATH`
elsewhere to override it.

```json
{ "roles": ["Backend Engineer", "Platform Engineer", "DevOps Engineer",
            "Full Stack Engineer", "Software Engineer"],
  "locations": ["Israel"], "results_wanted": 50, "hours_old": 72,
  "missed_runs_before_inactive": 3 }
```

`app/roles.py` loads and validates it. A missing file or an empty role list
**raises** rather than falling back to a built-in default: a daily run against a
silently-defaulted role set would ingest the wrong pool for as long as nobody
noticed.

Run it with `python -m app.cli run-pool` (the daily cron). The scrape itself
reuses `scraper.scrape_for_criteria` — same jobspy wrapper, pacing, NaN
handling and `is_remote` correction the existing path already gets. The pool
differs in where its titles come from, not in how it scrapes.

## Identity: `pool_key`

Every listing gets one stable key across runs:

- the board's own `job_url` when there is one — the closest thing to a primary
  key a job board offers;
- otherwise `sha256(company + title + date_posted)`, which collapses the same
  posting re-scraped on the same day and deliberately does **not** collapse two
  genuinely different openings for the same title at the same company posted on
  different days.

Backed by a **unique** partial index (`uniq_pool_key`), so dedupe is a
constraint rather than a hopeful check-then-act: two concurrent runs cannot
insert the same listing twice. Duplicates within a single run collapse before
the write.

## Presence: inactive, never deleted

Each run marks every listing it saw as present (`missed_runs` reset,
`last_seen_at`/`last_seen_run_id` updated). Everything active it did **not** see
gets `missed_runs += 1`, and anything that reaches
`missed_runs_before_inactive` (3) flips to `is_active: false`.

Three, not one: a single scrape missing a job is routine — rate limiting, a
flaky detail fetch, a board reshuffling its result page — and flipping a live
posting inactive on one bad run is worse than noticing a day late.

An inactive job keeps its description, its facts and its history; it only leaves
the default view. A listing that reappears is reactivated with its counter
reset, so a board hiccup costs nothing permanent.

**Retention had to be taught this too.** The 60-day TTL on `discovered_jobs`
would otherwise have deleted pool jobs outright, quietly making "never deleted"
false. Pool jobs now opt out via `ttl_managed: false`, and the TTL index carries
`partialFilterExpression: {ttl_managed: true}`. It is a *positive* marker
because a partial index filter cannot express "field is absent" — Mongo rejects
the `$not` that `$exists: false` desugars to. Migrating off the old unfiltered
index creates the new one first and drops the old one only once that succeeded;
dropping first left the collection with no retention at all when the create then
failed.

## Facts: extracted once, never per user

When a job first enters the pool, one batched Haiku call reads what the posting
states:

| Field | |
|---|---|
| `required_years` | the minimum stated, integer; lower bound of a range. Never derived from a seniority word |
| `must_have_tech` / `nice_to_have_tech` | split the way the posting splits them; everything is must-have when it does not. "Exposure to" / "familiarity with" / "ideally" is nice-to-have |
| `must_have_groups` | the same must-haves as **requirements**: each inner array is one requirement, met by any of its members. `must_have_tech` is its flattening and exists only for the candidate filter's `$in` |
| `seniority` | one of the five bands, or null when ambiguous (lean permissive) |
| `domain` | industry / problem area |
| `location` | normalized, with a `(remote)` / `(hybrid)` marker when stated |

Stored on the job as `extracted`, beside the raw posting. It is **user-independent
by construction** — the endpoint reads no profile and scores nothing — which is
what makes one stored result valid for every user. It is never recomputed: an
already-present job is only touched for presence. The one exception is the
Greenhouse source's facts-only re-read of rows that predate `must_have_groups`
(`JobStore.NeedingFactsReReadAsync`, 100 per board per run, at most two tries).

**Why groups.** Stored flat, "languages such as Go, Ruby, or Python" and
"PostgreSQL or MySQL" were five requirements, and a Python + PostgreSQL
candidate was counted as missing three. On Deliveroo's "Software Engineer" that
was 6 of 8 "absent", Core Stack capped 12 → 4, Technical 15/35, for a
candidate who met every stated requirement. Re-extracted, the 29 Deliveroo UK
engineering postings went from up to 11 names to at most 4 requirements each.
Rows without groups read each flat name as a group of one — exactly how they
were counted before.

The call lives in the API (`POST /api/match/job-facts`) like every other
Claude call; the scraper delegates over HTTP. It takes no user identity, shares
the `discovery` rate-limit bucket, and caps descriptions at 50K chars.

A failed extraction does not cost a posting: the job is stored with
`extracted: null` and later runs retry it — but only while the listing is still
being seen, and only up to `MAX_EXTRACT_ATTEMPTS` (3). A posting nothing can
parse therefore costs three calls in its lifetime, not one a day forever, which
matters more as the role list grows. Past the cap the job stays in the pool
unextracted: it still appears in results, it just has no facts to filter on.
The run reports `jobs_extracted` against `jobs_new`, plus
`jobs_extract_retried` and `jobs_extract_abandoned`, so a silently-failing
extractor does not look like a normal run.

## The Analyst read, stored once

A pool document also carries `parsed` — the Analyst's structured read of the
posting, the document the Evaluator actually scores against. It used to be
computed inside the per-user scan, once per user per job.

It never belonged there. `BuildAnalysisBatchPrompt` takes no profile and the
user message carries only the job id and its description, so the result cannot
differ between users — verified as well as argued: the same posting under two
very different profiles produced **byte-identical requests**, and the outputs
differed *less* across profiles than across repeat runs of the same profile.
What varies is sampling, not the candidate. Meanwhile it cost **2.1x the entire
global ingest pipeline**, per user, forever, and it never cached: its ~810-token
system prompt sits below Haiku's 2,048-token minimum cacheable prefix, so every
one of those input tokens was billed at full price on every call.

Three fields come with it:

| field | meaning |
|---|---|
| `parsed` | the `ParsedJob` document |
| `parsed_with` | stamp of the prompt+model+temperature that produced it |
| `parse_coverage` | the quality cross-check below, or null when not measurable |

**A different `parsed_with` means stale, not wrong.** Nothing re-parses on sight
of one: a prompt edit would otherwise become an immediate re-parse of the whole
pool. The parse is still used; the backfill replaces it in its own time.

**A missing parse is never a reason to hide a job.** The per-user scan parses
inline for exactly the jobs that lack one — which is what it did for every job
before this existed, so a cache miss is never worse than no cache.

### Freezing removes a dice roll, and makes one permanent

The Analyst is not deterministic even at temperature 0. Measured across five
runs of one posting: `domainContext`, `processSignals`, `responsibilities` and
`technicalRequirements` each produced **four distinct values**, and downstream
scores swung 33-45. Storing one read removes that per-user variance — and makes
whichever read you got everyone's.

So `parse_coverage` checks it, at write time. `job-facts` read the same posting
under a different prompt; coverage is the share of the requirements *it* found
that the parse mentions anywhere the Evaluator can see. Measured across 61
production jobs: median 1.00, mean 0.96, and **nothing between 0.33 and 0.67** —
the threshold sits in that gap rather than at a number someone picked.

It flags; it never blocks. A posting is worth more than our confidence about it.

**This is why `job-facts` and the Analyst stay two calls.** Merging them saves
one copy of the JD, about $0.0007 a job, and destroys the only independent read
of a parse that is now shared and durable. That trade was cheap when every user
parsed for themselves and threw the result away; it is not cheap when one bad
parse is handed to everyone for the life of the row.

## What a pool document must never hold

Only what is true of the posting for everyone. A pool row is shared, so any
field on it that means "this user thinks..." is a leak waiting to happen.

`dismissed` and `saved_to_tracker` were exactly that, and they hid postings for
every user when one user acted. They now live per user in `poolJobState`
(`app/services/pool_state.py`), keyed `(UserId, JobId)` like `jobScores`.
Scores went the same way in Step 5, for the same reason.

`is_duplicate` is still written onto the document by the criteria-driven path.
That path's rows carry a `criteria_id`, and a criteria belongs to exactly one
user, so those documents are single-user in practice. Pool rows never get the
field. Nothing writes it true any more; it goes with the criteria documents
in the data cleanup (docs/scraper-slimming.md).

The test to apply to a new field: **would two users ever disagree about it?**
If yes, it belongs in a per-user row, not on the job.

## Measured size (2026-09-12)

One real run over the five baseline roles — Israel, `hours_old=72`,
`results_wanted=50`:

| | |
|---|---|
| Raw results | 250 (5 searches × 50, none failed or empty) |
| Unique jobs | **167** |
| `distinct pool_key` | 167 — dedupe held exactly |
| Wall clock | ~9 minutes |
| Extraction cost | $0.33 cold, $0.00198/job (Haiku 4.5 list price) |
| Steady state | the next run found 1 new job of 168 → roughly $0.02–0.08/day at 10–40 new/day |

**This is why there is no vector DB.** At this size the per-user pre-filter is a
scan over a few hundred documents; retrieval infrastructure starts earning its
keep two orders of magnitude further up. Revisit if the number below ever
approaches tens of thousands — not before.

### Two things the 167 is not

**It is not the supply.** All five searches returned *exactly* 50, which is
`results_wanted`. Every one hit the parameter, so 167 is bounded by the
parameter and not by the market — the real number of matching open roles is
unknown and higher. Raising `results_wanted` is the only way to find out.

**It is not the pool size.** 167 is one scrape's 72-hour window. The pool
accumulates under 60-day retention while listings stay active, so steady state
is more like 600–2,500 documents. Both figures are well inside "no vector DB",
but quoting 167 as the pool size would understate it by an order of magnitude.

### Re-measuring

```bash
# API must be up for job-facts extraction.
MONGODB_DATABASE_NAME=<scratch> API_BASE_URL=http://127.0.0.1:5002 \
  python -m app.cli run-pool
```

Against a scratch database, never the live pool: a measurement run inserts real
jobs, and mixing it into the live pool makes the next run's "new vs refreshed"
counts meaningless. Read the unique count from `distinct pool_key`, and the cost
from the API's `Claude job-facts usage` lines.

## Role growth

The role list has two halves, and the split is the design.

**Baseline** — `config/roles.json`. Human-authored, always searched, never
dropped by user churn. A file because it is a decision that should survive
every deploy and everyone coming and going.

**Grown** — the `pool_roles` collection. A new user's CV may reveal a role
nothing on the baseline covers; that role joins the daily run, and leaves again
when the last user under it does. In Mongo because the app writes it: a file the
app edits would be lost on the next container restart and would diverge between
replicas.

### How a role joins

On profile save, `PoolRoleService` asks one cheap Haiku call which single search
term covers this candidate's work, given the roles already being searched. The
prompt pushes hard toward **reuse**: a Go backend engineer, a Python backend
engineer and a backend-leaning full stack engineer all belong under an existing
"Backend Engineer". Only a genuinely uncovered candidate — a data scientist, a
mobile engineer — gets a new role, and it must be a generic canonical title (no
seniority, no technology, no company).

This runs off the request path. A role list that lags a profile save by a second
is a much better outcome than a save that fails because of one, and the next
save re-derives everything from scratch.

`null` is a real answer: a profile too thin to place leaves the list untouched
rather than spending a capped slot on a guess. The model's `existing` claim is
re-checked against the list server-side — a role reported as existing but absent
from it would otherwise occupy a slot while looking free.

The scraper mirrors the baseline into `pool_roles` at startup
(`roles.publish_baseline`) purely so the classifier can see it: the API is a
separate service with no access to the config file, and classifying against an
empty list is how you end up searching both "Backend Engineer" and "Backend
Developer". Those mirrored rows carry no users and are exempt from deletion.

### How a role leaves

A role exists while at least one user's profile places them under it. Claiming a
role releases every other claim, so switching roles and dropping one are the
same operation, and a role whose last user leaves is deleted. Emptying a profile
releases without claiming.

"No active user needs it" is therefore *derived* from an empty user list rather
than tracked separately — one representation, nothing to keep in sync.

### The cap

`max_roles` (default 12) bounds the whole list, baseline included, and is
enforced in the scraper when the run is assembled — that is where a role costs
something (titles × locations of extra scraping per day), and it is the half
that knows the config file.

Baseline roles are never cut. Grown roles compete for what is left, **most-needed
first, then oldest**, so the cap behaves like a queue rather than a race: a role
several users need is not displaced by one that arrived later. Roles over the
cap are held back and named in a warning, not dropped — raising `max_roles`
admits them on the next run. Loading a config whose `max_roles` is below the
baseline count raises, since such a cap could never be honoured.

## Not here yet


The Matches page reads the pool through the per-user scan (Step 5), and role
growth is in place (above).

Scoring has moved out of ingest entirely — both the daily pool run and the
criteria-driven run now only extract facts. The criteria path writes into the
same pool (same `pool_key`, same presence lifecycle, same TTL exemption), so
what is left of it is a manual way to pull an ad-hoc search into the pool
rather than a second pipeline. Retiring it is tracked in `Tasks.md`.