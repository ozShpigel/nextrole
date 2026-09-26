# The Greenhouse source

A second job source, independent of the LinkedIn pool: it reads company career
boards directly from the Greenhouse boards API, cleans the posting text, embeds
it, and stores it in its own collection with a vector index.

**It is the first ATS source in an intended migration away from LinkedIn
scraping, not a permanent second feed.** Everything here is shaped by that: it
depends on nothing in `discovered_jobs` or its mechanics, and it stores the
*same* extracted-fact contract the Evaluator and `CandidateFilter` already
consume — so scoring works unchanged when the source flips.

Nothing here scores anything, does per-user work, or touches the pool. See
`docs/job-pool.md` for the LinkedIn side, which this leaves entirely alone.

## What it is for

The vector collection is a **recall prefilter**: it decides which jobs the
Evaluator spends a call on. It is not a score and never becomes one. Ranking by
cosine similarity to a profile answers "could this plausibly be for them"; the
Evaluator answers "is it any good".

## The board endpoint

`GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` — public, no
auth, one call per company.

**It does not paginate.** Measured on four boards: `meta.total` equalled the
returned job count every time (stripe 665, gitlab 216, airbnb 168, similarweb
66). Stripe's board, the largest tested, is 5.1 MB with `content=true` and
arrives in 1.7 seconds.

That makes `meta.total` a free integrity check rather than a cursor, and it is
used as one. There is no page to be incomplete, but a *body* can be truncated —
a reset part-way through 5 MB — and `BoardClient` throws when the count
disagrees. **A short read must never be treated as jobs closing.**

### `content` is entity-encoded HTML

The field literally contains `&lt;h2&gt;&lt;strong&gt;Who we are`. It must be
HTML-decoded **before** tags can be stripped, and again afterwards for entities
that lived inside the markup.

Getting this wrong is silent and permanent: the stored text would be markup, the
SHA-256 of that markup is perfectly stable, and every later run compares an
unchanged hash and skips. Nothing ever re-reads it. `ContentCleaner` does both
passes and `ContentCleanerTests` pins them.

## Per company

`CompanyHandler.HandleCompanyAsync(boardToken, ct)` — self-contained,
idempotent, throws on failure. **No transport type appears in it**; the queue
calls it, never the reverse, and the tests drive it by calling the method.

1. Fetch the whole board.
2. Clean the HTML; strip trailing boilerplate (EEO, privacy, pay transparency)
   only when it is a heading, on its own line, in the last third of the posting,
   and only if the cut leaves most of the text. Conservative on purpose: cutting
   early destroys requirements, which is the signal the source exists for.
3. **Keep what is stored whole; decide what is worth paying for.** A NEW
   posting the pre-read filter rules out (see below) is not embedded, read or
   stored. Everything stored is kept as it is; `department` and `office` are
   stored so narrowing it is a query, not a re-ingest.
4. Skip anything whose content hash is unchanged — no embedding, no write.
5. Embed what remains, batched by estimated token budget (~100K, cap 128 items),
   splitting and retrying on a 400. `input_type: "document"`.
6. `BulkWriteAsync` **per batch**, upserting on `(boardToken, greenhouseJobId)`
   behind a unique index. Per batch, not at the end, so a failure keeps the
   earlier batches and the money already spent on them.
7. Stamp the board's logo on every row it has (see below).
8. Close what is gone; reopen what came back. **Never delete.**

### Company logos

The boards API returns no logo, and a board token is a Greenhouse slug, not a
domain, so the domain is configured per company in `companies.json`
(`company_domains`). The ingest resolves `logo_url_template` (default: Google's
keyless favicon service, `sz=128`) and writes the URL to `company_logo` — the
pool's field name, so every surface that shows a logo reads it unchanged.

It is a **per-board `UpdateMany`, not part of the upsert.** The hash skip never
rewrites an unchanged posting, so a logo carried on the upsert would reach only
postings that changed after the domain was configured. The stamp writes only
rows that differ, clears the logo when a domain is removed, and never fails the
company: a logo is display-only, and a nack would throw away paid embeddings.
Swapping services (e.g. logo.dev) is an edit to the template; the next run
restamps every row.

### The reads through the Message Batches API

job-facts and job-parse were about three quarters of the production Anthropic
bill (measured 2026-09-23: parse 46%, facts 31%, scoring 24%), and nothing waits
on them. With `Greenhouse__UseBatchApi=true` the consumer submits them to the
Message Batches API instead -- **same prompts, model and chunks** (the API builds
the live and batch requests from one builder), at half the price, answered within
minutes to hours.

- **Submit** (`IngestBatcher`, from `CompanyHandler`): changed + never-read
  postings get facts and parse batches; re-read postings get facts only. A row in
  `greenhouse_ai_batches` is written right after the submit (a batch with no row
  is paid for and never collected), then each posting is marked
  `ai_pending_facts` / `ai_pending_parse` with the batch id.
- **Pending postings** are skipped by the backfill and re-read selectors (no
  paying twice), and a posting with `ai_pending_parse` is skipped by the
  candidate search: scored now, it would be parsed inline at full price per user,
  and a new one would be scored before its facts could filter it.
- **Collect**: a loop in the consumer, every 5 minutes. Ended batches are stored
  with the same `SaveIngestAiAsync` the live path uses -- a parse is verified
  against the stored posting text first (the API keeps nothing between calls) and
  does not count an `extract_attempts` (a live read counted facts + parse once).
  A marker is cleared only by the batch that set it. A batch older than 48h is
  abandoned and its postings are read again.
- **The collector runs whether or not the flag is on**, so switching it off never
  strands open batches (and their hidden postings).
- API: `POST /api/match/job-facts/batches`, `GET .../job-facts/batches/{id}`,
  `POST /api/match/job-parse/batches`, `POST .../job-parse/batches/{id}/collect`.
  Same limits as the live endpoints; 200 postings per submission. The LinkedIn
  pool ingest still uses the live endpoints.
- Cost stays visible: every result logs `Claude job-facts-batch usage` /
  `job-parse-batch usage`, the same shape as the live lines.

### The pre-read filter

Every posting on every board used to be read by Claude, embedded and stored --
an Account Executive in Tokyo included -- and the Matches filters then hid it
from everyone. The reads are the ingest's cost, and they grow with the company
list, not with who uses the product. So before paying, the consumer looks at
what the board returns for free:

- **Location.** A new posting whose board location and offices name no served
  location is skipped. Served = `served_locations` (`companies.json`) **plus**
  every user's own location terms from `pool_locations`: a profile's "Tel Aviv,
  Israel" serves `tel aviv` and `israel` from the next run, with no config edit
  and no deploy. City *and* country, because a board names either and spellings
  differ ("Tel Aviv-Yafo"). Whole words, so `UK` does not match `Ukraine`. An
  empty `served_locations` means no location filtering at all -- learned terms
  never switch it on.

  **Skipped only when clearly elsewhere**, like the function rule. A text match
  on a served term reads the posting; otherwise the location is resolved to
  countries (`Places`, an offline GeoNames list: cities over 15,000 people,
  countries and aliases, US/Canadian states -- `Data/places.tsv`, rebuilt by
  `Data/build_places.py`). "Munich" is Germany, so a Berlin user's `germany`
  serves it even though the board never wrote the country. Names are ambiguous
  (London is GB and CA; "IL" is Israel and Illinois), so a posting's countries
  are the union and it is read if any is served -- ambiguity can only cost a
  read. Text that resolves to nothing ("Hybrid", "HQ", a small town) is read.
  On the served side a term serves a country only when it means exactly one
  ("UK", "Tel Aviv"; not "London", which would serve all of Canada).
  Measured on the 263 local postings: the same 92 location skips as the text
  match -- New York, Tokyo, Prague, Barcelona, Dubai, Milan -- all clearly
  elsewhere. Place data (c) GeoNames, https://www.geonames.org, CC BY 4.0.
- **Function.** A new posting whose title -- or, when the title says nothing,
  its department -- *clearly* belongs to a function no user wants is skipped.
  "Wanted" comes from real profiles, and each one is widened by its neighbours
  (`JobFunctions.AcceptedFor`) exactly as Matches widens it.

Both come from one place: on every profile save the API records the profile's
functions in `pool_functions` and its location terms (`PoolDemand.LocationTermsOf`)
in `pool_locations` (`PoolDemandRepository`); a value leaves when its last user
does. The ingest reads both through the same `PoolDemand` class
(`PoolDemandReader`), so the two processes cannot disagree on field names.

**Knowingly inexact, so it leans hard towards reading** (`Prefilter`). Any
technical word in the title -- engineer, data, analyst, security, technical...
-- means read ("Technical Recruiter", "Sales Engineer"). Two departments that
disagree, an unknown department, no recorded demand at all: read. A wrong guess
must cost an extra read, never a lost job.

**Only new postings.** A stored posting was already paid for; dropping it from a
run would skip its presence touch and hand it to the close diff.

**Nothing is lost for good.** A skipped posting is not stored, so every run sees
it as new and asks again. When a user arrives with its function or location,
the next run reads it -- no backfill. Until then that user sees little on
Matches; triggering a run when a new function or location appears is the
follow-up (Tasks.md), and only matters once the filter is On.

**`Greenhouse__Prefilter`**: `off` | `log` (default) | `on`. In `log` it skips
nothing and writes two lines per board:

```
pre-read filter (Log) -- 12 of 30 new posting(s) would be skipped: 8 outside served
  locations (18 configured + 4 from profiles), 4 a function nobody wants
  (wanted: infrastructure, ...). E.g. ...
pre-read filter check -- 41 stored posting(s) guessed from title/department,
  39 labelled by Claude: 37 right, 2 wrong, 0 wrong in a way that would hide a
  wanted posting. Wrong: ...
```

The second line is the measurement: the guess against the function Claude read
from the whole posting, on postings already stored. A third,
`pre-read filter location check`, does the same for locations: of the stored
postings the location rule would skip, how many Claude placed somewhere served
("would hide"). **Switch to `on` only once
"would hide a wanted posting" reads ~0** across a few runs.

Measured on the 263 open postings of the three local boards, with an
infra/software demand (2026-09-26): **151 skipped (57%)** -- 92 by location, 59
by function (sales 21, operations 15, marketing 9, design 6, product 6,
customer success 2) -- and not one engineering, data or security role among
them. The one wrong guess it showed ("Group Product Manager, Regulatory Finance"
taken for finance) fixed the rule order.

First check on the box (2026-09-26, 3 boards): 128 stored postings guessed,
121 labelled by Claude, **110 right, 11 wrong, 1 would have hidden a wanted
posting** -- "Senior Financial Crime Investigator", guessed operations from
"financial", labelled security (an infra user's neighbour). Claude's labels are
split on fraud/risk/compliance and on product marketing, so the rule now
abstains on those words instead of guessing. The other ten were between
functions that are each other's neighbours (sales/customer success,
marketing/sales), which cannot hide anything. Cost of abstaining, on the same
263 local postings: 146 skipped instead of 151 (56% instead of 57%).

**The bar for `on`:** 0 "would hide a wanted posting" over the **distinct**
labelled postings of the boards in the config, and it must **stay at 0 as each
board is added** -- a new board's postings join the check on its first run.
Counted in distinct postings, not checks: every run re-checks the same stored
postings, so three runs over ~116 postings are 116 postings seen three times,
not 348. (First written as "300 checked postings over 3 runs", which counted
the same postings repeatedly.)

Second check on the box (2026-09-26, after the abstain fix): 116 labelled,
**109 right, 7 wrong, 0 would hide**. Five of the seven are neighbour pairs
(sales/customer success, marketing/sales). Two involve operations, which has no
neighbours: "Creative Project Manager" (guessed marketing) and "Global Program
Manager" (guessed customer success) -- invisible today because no user wants
operations, and caught by this same check the day one does. Decided: 116
distinct postings at 0 is enough for these three boards.

**Fill `pool_functions` and `pool_locations` from existing profiles** after a
deploy that adds either -- otherwise demand is only whoever has saved since,
the check undercounts, and with the filter `on` the rest lose postings.
`deploy/mongo/fill-pool-demand.js` rebuilds both; idempotent, and it reads the
database names from `.env.api` exactly as the API resolves them. `deploy/` is
not synced, so copy it over first (from WSL):

```bash
scp deploy/mongo/fill-pool-demand.js nextrole:/srv/nextrole/
# then on the box, in /srv/nextrole:
docker run --rm --env-file .env.api -v "$PWD/fill-pool-demand.js:/fill.js:ro" mongo:7 \
  sh -c 'mongosh --quiet "$MongoDB__ConnectionString" /fill.js'
```

Its location split mirrors `PoolDemand.LocationTermsOf`; change both together,
or the next profile save corrects the difference.

### The two guards

| | |
|---|---|
| **Never diff on a failed fetch** | Structural, not a flag. `BoardClient` *throws* on a non-2xx, an unparseable body or a `meta.total` mismatch, so control never reaches the diff. A 429, a 500 and a truncated response all leave the company's stored jobs exactly as they were. |
| **Empty response against a large stored set** | `CloseDiff.Compute` refuses the diff when the board returned nothing and ≥10 jobs are stored open. It deliberately does *not* fire on a small stored count — a board with three jobs really can empty, and a guard that never lets go is its own bug. |

`CloseDiff` is pure so both are tested on the code that runs, not on a
restatement of it.

## Queue semantics

Durable queue, persistent messages, publisher confirms, prefetch 1, **manual ack
only after the Mongo write**. A failed company is nacked with `requeue: false`
to a dead-letter queue.

Not requeued, deliberately: requeueing a 429 sends it straight back to the same
consumer — a hot loop against a service that just asked us to slow down, with
every other company blocked behind it. The retry is tomorrow's timer.

### The consumer is long-running, not one-shot

A one-shot consumer would have to decide when the work is finished, and **an
empty queue is not that**: a message can be in flight, or delivered and unacked
and about to be redelivered. Both look identical to "nothing left".

The only honest stop condition is the ledger — zero `pending` rows for the day —
and a consumer that polled it would hang forever the first time one company got
stuck. Staying up moves "are we done?" to something anyone can query
(`RunLedger.PendingAsync`) and out of the exit path of the process that would
have to be right about it.

### `greenhouse_runs`

One row per company per day. The **publisher** writes it `pending` *before*
publishing; the **consumer** resolves it to `done` or `failed` with the error.

That order is the point. A row written first and a publish that then fails
leaves a visible pending row, which is correct — the company genuinely was not
handled. The other order loses the company entirely if the process dies between
the two, and nothing anywhere records that it was meant to run.

## The extracted-fact contract

`greenhouse_jobs` stores `extracted` with the **same shape and the same field
paths** the pool uses — `extracted.location`, `extracted.seniority`,
`extracted.must_have_tech` — because `CandidateFilter` and the Evaluator must
work against this collection unchanged when it becomes the primary source.

`PoolContractTests` enforces that: it scans `PoolJobRepository` for the
`extracted.*` paths it actually queries and fails if `GreenhouseJobFields` does
not declare every one. Without a check, "keeps the same contract" is a comment
that goes stale the first time someone renames a field on one side.

**The facts are unstated today, and that is safe rather than broken.** Every
clause in `PoolJobRepository` is "matches OR is unstated", because the
extraction is best-effort and a job with no facts must never become invisible to
everyone. A Greenhouse row therefore *passes* the candidate filter.

It is stored as a **sub-document with explicit null leaves**, not as a null
`extracted`:

```json
"extracted": { "location": null, "seniority": null, "must_have_tech": [],
               "nice_to_have_tech": [], "required_years": null, "domain": null }
```

That shape is not cosmetic. An Atlas vector-search filter does not match a
missing path, so a null parent made every `extracted.*` filter return zero rows
— see **Measured** below. `extract_attempts: 0` remains the honest signal that
nothing has read the posting yet.

Populating it is the pool's existing extraction — one batched call per new job,
in the API, exactly once on entry. The consumer delegates over HTTP rather than
holding a key, like every other caller (`IngestAiClient`, reached at
`Api:BaseUrl`).

**The reads are optional at startup, and that is the trap.** Without
`Api:BaseUrl` the consumer still runs and still embeds; it logs one warning and
then stores every posting with an empty `extracted` and no `parsed`, forever.
Nothing errors. What it silently costs: the server-side `stackedGaps` check goes
inert, so Core Stack is scored on the model's own unchecked reading; the
location and seniority filters fall back to raw board text; and every per-user
scan pays for an inline Analyst parse — measured at 2.1x the whole ingest
pipeline. It was missing from `docker-compose.yml` and from the production box
at the same time. It is a Docker DNS **service** name and container port, never
localhost.

**The hash skip cannot repair that, which is why there is a backfill.** The AI
passes run only over postings whose content *changed*, so "never attempted" and
"attempted, unchanged" are the same thing to the hash — and a posting stored
during an outage stays factless until the company edits their own text.
`NeedingIngestAiAsync` selects on `extract_attempts: 0` (the value the initial
write sets) oldest-first, and `CompanyHandler.BackfillIngestAiAsync` sweeps up
to `BackfillBatchSize` (100) per board per run, after the changed-job pass.
Attempts are incremented whether or not facts come back, so a posting the model
genuinely cannot read leaves the set after one try instead of being retried
forever — the sweep bounds itself. It deliberately does **not** touch
`contentHash` or `embedding_v1`: the vectors are valid and already paid for, and
re-embedding to fix a missing parse would spend money for no reason. Covered by
`IngestAiBackfillTests`.

## Retrieval

`ICandidateJobStore.FindCandidateJobIds(renderedProfile, filters, n)` over Atlas
`$vectorSearch`. Lives in the API; an interface so the store is swappable.

- The query text is the **rendered `StructuredProfile`** — what `ProfileRenderer`
  produces. Not a job title and not a keyword: the document vectors describe
  4,000-character postings, and a two-word query lands nowhere near them in the
  same space.
- `input_type: "query"` against the ingest's `"document"`. **That argument is the
  only difference between the two paths.**
- Returns **ids**, not documents. A prefilter that returned job bodies would
  invite the caller to read a second source's postings through a retrieval API.

### Filters must be in the index

`location`, `seniority` and `closedAt` are declared as filter paths so they are
applied *during* the search. A `$match` after `$vectorSearch` filters what the
limit already truncated: ask for 200, get however many of those 200 survive —
and it degrades silently, because a short result set looks like a thin pool.

One deliberate divergence: the pool matches location by regex, and a vector
search filter cannot express one. This matches exact values, or leave it empty
and let the vector do the work — location is in the embedded text.

### Job functions

Boards are kept whole, so an Israeli search reached every Israeli posting in the
collection -- sales, design and M&A included -- and each cost a Claude call to
score near zero. The LinkedIn pool never had this: it only scraped the titles it
searched for.

- **The list** is fixed in code (`JobFunctions.All`: software_engineering,
  infrastructure, data_engineering, data_science, analytics, qa, security,
  product, design, sales, marketing, customer_success, operations). Free text
  would repeat the location problem.
- **Postings** get up to two in `extracted.functions`, from the job-facts read.
  Off-list values are dropped server-side. An absent field marks a row as owed a
  facts re-read (same rule as `must_have_groups`), so stored postings are
  labelled by the existing re-read; an empty array means "read, unclear".
- **Profiles** get up to three in `StructuredProfile.Functions`, from the CV
  read. Not rendered into prompts, so scores do not move. A profile saved before
  this has none until the CV is uploaded again.
- **Matching** widens the profile's functions by fixed neighbours
  (`infrastructure` also accepts `software_engineering`, `data_engineering`,
  `security`) and keeps a posting when any of its functions is accepted.
  **Empty passes on both sides**: an unread or unclear posting is always shown,
  and a profile with no functions filters nothing.
- **Off by default** (`Greenhouse__FilterByFunction`). A confident wrong label
  hides a job with no symptom, and "is this the right label" has no exact check.
  Until it is switched on, every scan logs what it *would* drop, with titles:
  `Greenhouse function filter (counting only): N of M posting(s) are outside ...`.
  Read those, and the stored labels, before turning it on:

  ```js
  db.greenhouse_jobs.find({ closedAt: null }, { title: 1, "extracted.functions": 1 })
  ```

Applied after the vector search, like seniority -- not in the index -- and in
three places, all behind the same flag: the scan (what gets scored), the band
(unscored cards, which go through the same candidate search), and the browse of
already-scored cards (`PoolBrowseService` passes the profile's accepted set to
`BrowseAsync`). The last one matters because the counting-only scans still score
what they log: without it, those postings stay on the board after the switch. It
filters at read time, so switching the flag off brings them back.

## One model, one set of dimensions

`GreenhouseEmbeddingOptions` (`Greenhouse:Embedding`) is bound by **both** the
API and the ingest. Model and dimensions are deliberately **not** in
`config/companies.json`, which ships inside the ingestion image and which the API
cannot read.

If the two ever disagreed, nothing would error. A stored 1024-vector queried
with a 512-vector returns an empty result, indistinguishable from a profile that
matches nothing; two different models return real ids that are simply not the
relevant ones. It is why the ingest image is built by `api.yml`, from the same
commit as the API, and why the deploy recreates the consumer rather than only
pulling it.

Changing either is not a config edit: it means a new `embedding_vN` field, a new
index, and re-embedding every stored job.

## Measured

All figures from real runs against the `similarweb` board (66 jobs) on
2026-09-19, `voyage-4` at 1024 dimensions.

| | |
|---|---|
| Tokens for the whole board | **69,510** (Voyage's own `usage.total_tokens`) |
| Per job | **1,053 tokens** — about **$0.000063** at $0.06/M |
| Whole board | **$0.0042**, and $0 in practice while the 200M free-token allowance lasts |
| Fetch | ~1 s for 66 jobs; 1.7 s for Stripe's 665-job, 5.1 MB board |
| Embed + write | ~5 s in one batch |
| End to end | **~6-7 s** of work per board |
| Second run | 0 embedded, 66 skipped, **0 tokens** |

The 4-chars-per-token estimate used for batch packing is conservative: the real
ratio here was **5.1 chars/token**, so the estimator over-counts by about 25%
and batches come out slightly smaller than the budget allows. That is the right
direction to be wrong in.

Extrapolating to Stripe's 665 jobs (mean 4,427 cleaned chars): roughly 575K
tokens, six batches at the 100K budget, about **$0.035** per full ingest — and
near zero on every later run, because only changed postings are re-embedded.

### Vectors are stored as `BinData` float32, not an array of doubles

`JobStore` writes `new BinaryVectorFloat32(vector).ToBsonBinaryData()` (BSON
subtype 9). The vector arrives from Voyage as float32 and is parsed into
`float[]`, so the previous `(double)v` widened every value to 8 bytes to carry
4 bytes of information, 1024 times per job.

Measured on the production collection:

| | array of doubles | `BinData` float32 |
|---|---|---|
| vector | 8,192 B | **4,098 B** |
| whole document | 19,545 B | **10,417 B** (−46.7%) |
| retrieval (4 profiles x 10 ids) | baseline | **identical ids and order** |
| top-8 scores | baseline | ~1e-11 apart |

**This is not a precision trade.** The round-trip is lossless by construction,
and a float64 -> float32 -> float64 pass over all 66 stored vectors (67,584
values) differed by exactly `0.000e+00`. It is the same numbers in half the
bytes.

`$vectorSearch` reads both representations and a mixed collection queries
correctly, verified with a one-document probe against the live index, so a
migration does not have to be atomic with a deploy.

### Comparing retrieval across a storage change

`CandidateRetrievalIntegrationTests.Retrieval_matches_the_captured_baseline`
captures the top N ids for several profiles, then compares after the change.
Three things about it are deliberate:

- **It compares ids and rank order, NOT scores.** An ordinary `TouchAsync` over
  the collection triggers an Atlas index rebuild, and a rebuild alone moves
  scores by ~1e-4 with nothing wrong. Asserting exact scores fails on a run
  that changed nothing.
- **It has a vacuity guard.** A broken index returns nothing, and an empty list
  equals an empty list, so a naive diff passes loudest exactly when retrieval
  is most broken.
- **A capture run fails deliberately**, so writing a baseline can never be
  mistaken for a passing comparison.

It also uses four unlike profiles (backend, frontend, data, sales) pulling
different slices of the same board. One profile could return the same wrong
answer before and after and still diff clean.

### Three things that only showed up by running it

**An Atlas vector-search filter does not match a missing path.** Storing
`extracted: null` made every `extracted.*` filter return **zero** rows, while
`closedAt: {$eq: null}` worked — because that one is an explicit null *leaf*.
Regular MQL hides this: `$eq: null` matches a missing field there, and
`$exists` is available as a fallback, which is exactly what `PoolJobRepository`
relies on. A vector-search filter has neither. `extracted` is therefore stored
as a **sub-document with explicit null leaves**, which still satisfies the
pool's permissive clauses (`Eq(field, null)` for scalars, `Size(field, 0)` for
arrays).

**Embeddings are reproducible, but only per batch composition.** The same text
embedded twice in the same shape of request returns bit-identical floats. The
same text alone versus in a batch of two does not — cosine 0.99998. So after a
kill-and-restart the final rows are identical in every field except the vectors,
which differ at ~2e-5 cosine because the batches were composed differently.
"Same rows" cannot mean byte-identical vectors, and nothing should be written
that assumes it.

**A successful `publish` exited non-zero.** `ProcessExit` fired after a
`using`-scoped `CancellationTokenSource` had been disposed, so `Cancel()` threw
and the process exited 127. systemd would have reported a failed job every day
while the run itself was fine.

## Configuration

`Greenhouse__UseBatchApi` (consumer, default `false`) sends the two reads
through the Message Batches API — see above.

`Greenhouse__Prefilter` (consumer, `off` | `log` | `on`, default `log`),
`served_locations` in `companies.json`, and the learned `pool_functions` /
`pool_locations` drive the pre-read filter — see above. An
unknown value is fatal: guessing `on` would skip postings unmeasured.

`server/api/src/Greenhouse/config/companies.json` — board tokens, each
company's domain for its logo, and batch limits. Loaded like `roles.json` and **fatal** on a missing
file or an empty list: a run against a silently-defaulted list still ingests
jobs, they are simply the wrong company's.

**No board token appears in code or in any test.** Tests build a config in
memory via `CompaniesConfig.ForTesting`. Going from one company to fifty is an
edit to that file and nothing else.

## Deploying it the first time

**Do the manual steps BEFORE merging.** Merging to `main` is the deploy, and
`api.yml` now ends with:

```
docker compose --profile cron pull greenhouse
docker compose pull greenhouse-consumer
docker compose up -d --force-recreate greenhouse-consumer
```

If `/srv/nextrole/compose.yml` does not yet define those services, that step
**fails, and it fails the whole job -- including the API deploy that runs in the
same workflow**. `deploy/` is not synced by CI, so the repo being correct does
not make the box correct. This is the third time that gap has bitten; it is
worth reading twice.

### On the box, first

1. Copy `deploy/compose.yml` (adds `rabbitmq`, `greenhouse`,
   `greenhouse-consumer` and the `rabbitmq-data` volume).
2. Copy `deploy/rabbitmq/10-nextrole.conf` to `/srv/nextrole/rabbitmq/`.
3. Copy both `deploy/systemd/nextrole-greenhouse.*` to `/etc/systemd/system/`,
   then `systemctl daemon-reload && systemctl enable --now nextrole-greenhouse.timer`.
4. Write `.env.rabbitmq` and `.env.greenhouse` from `deploy/.env.example`.
   The credentials in `.env.rabbitmq` only take effect on a **fresh volume**.
5. Add `Greenhouse__Embedding__*` to `.env.api`. **The three values must match
   `.env.greenhouse` exactly** -- a mismatch is silent, because `$vectorSearch`
   returns an empty result rather than an error.
6. `docker compose up -d rabbitmq` and wait for healthy.

### Then the Atlas index

The vector index does **not** create itself. Without it every search fails, and
with the wrong `numDimensions` it silently returns nothing. On
`job-tracker.greenhouse_jobs`, matching `MongoCandidateJobStore.IndexDefinition`:

```json
{ "fields": [
  { "type": "vector", "path": "embedding_v1", "numDimensions": 1024, "similarity": "cosine" },
  { "type": "filter", "path": "closedAt" },
  { "type": "filter", "path": "extracted.location" },
  { "type": "filter", "path": "extracted.seniority" }
]}
```

Name it `greenhouse_vector_v1`. It takes a minute or two to become
`queryable`; creating it before any rows exist is fine.

**Check storage headroom first.** A stored job is ~10.4 KB, of which the vector
is 4.1 KB. See **Measured** for what that means per 10,000 jobs, and note the
free tier is 512 MB with `job-tracker` already using most of the difference.

### Verifying the deploy

A green tick means images were pulled, nothing more. Probe it:

```bash
# The broker is up and the watermark is ABSOLUTE, not 40% of host memory
docker exec -it $(docker compose ps -q rabbitmq)   rabbitmq-diagnostics -q status | grep -i watermark

# The timer is armed and has a next firing time
systemctl list-timers nextrole-greenhouse.timer

# The consumer is UP, not restarting -- a crashloop looks like "Up" for a
# second at a time, so check the restart count too
docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}'   $(docker compose ps -q greenhouse-consumer)

# Run the fan-out by hand rather than waiting for 06:15
docker compose --profile cron run --rm greenhouse publish   # must exit 0
docker compose logs --tail=20 greenhouse-consumer
```

Then in Mongo, the two questions that matter:

```js
// Is the day finished? Zero pending rows is the ONLY honest answer --
// an empty queue is not (docs above).
db.greenhouse_runs.find({ day: "<today>", status: "pending" })

// Did the pool stay out of it? These must not have moved.
db.discovered_jobs.countDocuments({})
db.discovered_jobs.countDocuments({ missed_runs: { $gt: 0 } })
```

**The second run is the real test.** Run `publish` twice and read the consumer
log: the second must say `0 embedded, N skipped, 0 tokens billed`. If it
re-embeds everything, the content hash is broken -- and nothing else will tell
you, because the only symptom is the bill.

## Running it

```bash
# Broker (local): 127.0.0.1 only, management UI on 15672
docker compose up -d rabbitmq

# Fan out one message per board token, then exit
docker compose --profile cron run --rm greenhouse publish

# Long-running worker
docker compose up -d greenhouse-consumer
```

**Locally, one board.** The root `docker-compose.yml` sets
`Companies__ConfigPath=config/companies.dev.json` for both services — `similarweb`
only, 66 postings measured 2026-09-23. Every new posting costs a facts read and an
Analyst parse (~712 output tokens measured), roughly half a cent each: about **$0.45
for a full run live, ~$0.25 with `Greenhouse__UseBatchApi`**. The real list is one
variable away, deliberately not the default — a day of local runs over every board
cost $6.25:

```bash
GREENHOUSE_COMPANIES_CONFIG=config/companies.json docker compose --profile cron run --rm greenhouse publish
```

Outside Docker, set `Companies__ConfigPath=config/companies.dev.json` yourself. Never
shrink a board by capping postings: the close diff would close everything beyond
the cap.

Production: `deploy/systemd/nextrole-greenhouse.timer` (06:15 UTC) runs the
`publish` container; the consumer is `restart: unless-stopped`.

**`deploy/` is not synced by CI.** `rabbitmq/10-nextrole.conf` carries
`vm_memory_high_watermark.absolute=512MB` and is manual state on the box. It has
to be a file: RabbitMQ 4 has no supported environment-variable form for that
setting, and the variable search results still suggest was removed and now does
nothing, silently. The watermark is absolute rather than the default relative
0.4 because the figure that takes 40% of is the **host's** memory, not the
container's limit.
