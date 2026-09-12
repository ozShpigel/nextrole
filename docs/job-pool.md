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
| `must_have_tech` / `nice_to_have_tech` | split the way the posting splits them; everything is must-have when it does not |
| `seniority` | one of the five bands, or null when ambiguous (lean permissive) |
| `domain` | industry / problem area |
| `location` | normalized, with a `(remote)` / `(hybrid)` marker when stated |

Stored on the job as `extracted`, beside the raw posting. It is **user-independent
by construction** — the endpoint reads no profile and scores nothing — which is
what makes one stored result valid for every user. It is never recomputed: an
already-present job is only touched for presence.

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