# Plan: one ingest, many job sources

Status: **plan**, 2026-09-26. Not built.

## Why now

The ingest is built around one source. Measured against the top of the
retired LinkedIn pool (2026-09-26), the companies your users want are spread
across at least six systems:

| Source | Companies found | Israel engineering roles (measured) |
|---|---|---|
| Greenhouse | 26 configured | the current pool |
| **Workday** | 10 -- NVIDIA, KLA, Applied Materials, Cisco, Intel, Medtronic, Thales, CrowdStrike, Motorola, F5 | ~570 |
| **Comeet** | 16 -- Aidoc, Cellebrite, Ceva, Claroty, Coralogix, DriveNets, Infinidat, Innoviz, Silverfort, ... | not yet measured |
| **Lever** (US + EU host) | Mobileye, Parallel Wireless, Cloudinary, Extreme, D-Fend, BioCatch | ~145 |
| **Ashby** | 18 smaller startups | ~50 |
| SmartRecruiters / Workable | Wix, ServiceNow / Nuvei | few |

Adding each as a one-off fork of the Greenhouse code would copy its guards
five times and let them drift. This plan makes "a source" a small, tested
unit, and everything else -- filters, storage, reads, triggers, closing,
Matches -- shared.

## Principles (kept from Greenhouse, now per source)

- **A failed fetch is not an empty board.** The single most expensive silent
  failure the ingest has: a partial list would close every posting it missed.
  Each source must prove completeness, or the close diff does not run.
- **One embedding model, one pool.** Every source stores into the same
  collection with the same vector, so retrieval and Matches never know or care
  where a posting came from.
- **Nothing a user could see is skipped; nothing nobody can see is paid for.**
  The pre-read filter (age, location, function) applies to every source, as
  early as each source's data allows.
- **Config, not code, adds a company.** Code is only for a new *kind* of
  source.

## Architecture

```
publish (daily timer / triggered run)
  └─ one message per board:  { boardKey: "workday:nvidia", live, runId }
        ↓ RabbitMQ
consume
  └─ BoardHandler (source-agnostic; today's CompanyHandler)
       1. source = registry[boardKey.source]
       2. listing = source.ListAsync(board)            ← adapter
             must return Complete=true or throw
       3. stage-1 prefilter  (location, function)       ← shared
       4. detail = source.DetailAsync(new ones only)   ← adapter (no-op for Greenhouse)
       5. stage-2 prefilter  (age, exact date)          ← shared
       6. hash skip → embed → store → facts reads       ← shared
       7. close diff  (only if listing.Complete)        ← shared
```

### The source contract

```csharp
interface IJobSource
{
    string Name { get; }                       // "greenhouse", "workday", ...
    SourceLimits Limits { get; }               // politeness: concurrency, delay, retries

    // Every posting on the board, lightweight. MUST throw on any failure, or
    // return Complete = false -- never a silently short list.
    Task<Listing> ListAsync(BoardConfig board, CancellationToken ct);

    // The full posting (text, exact dates) for the ones the handler will keep.
    // Sources whose listing already has everything (Greenhouse) return as is.
    Task<SourcePosting?> DetailAsync(BoardConfig board, ListedPosting p, CancellationToken ct);
}

record Listing(IReadOnlyList<ListedPosting> Postings, bool Complete, int? Total);

record ListedPosting(                          // enough for stage-1 filtering
    string SourceJobId, string Title, IReadOnlyList<string> LocationTexts,
    IReadOnlyList<string> Departments, DateTime? PostedAt, DateTime? UpdatedAt);

record SourcePosting(                          // what gets stored
    ListedPosting Listed, string ContentHtml, string Url, DateTime? PostedAt, DateTime? UpdatedAt);
```

An adapter is then ~200-400 lines: the HTTP calls, the mapping, and the
completeness proof for its API (Greenhouse `meta.total`, Workday `total`,
Lever/Ashby: none -- see below).

### Completeness per source

| Source | How a listing proves it is whole |
|---|---|
| Greenhouse | `meta.total` equals the count (today's guard) |
| Workday | pages fetched until `total`; count equals `total` |
| Lever / Ashby / Comeet | no total in the response: complete = HTTP 200 + parseable body + the **CloseDiff** size guard (refuse to close a large share of a board on one run). Weaker, so documented as weaker. |

`CloseDiff`'s existing guard (an empty response against a large stored set)
generalises to "a response that would close more than X% of a board's open
postings" for sources without a total.

### Board config (`companies.json` → `boards.json`)

```json
{ "boards": [
  { "source": "greenhouse", "token": "wizinc",  "name": "Wiz",    "domain": "wiz.io" },
  { "source": "workday",    "token": "nvidia",  "name": "NVIDIA", "domain": "nvidia.com",
    "host": "nvidia.wd5", "tenant": "nvidia", "site": "NVIDIAExternalCareerSite" },
  { "source": "lever",      "token": "mobileye","name": "Mobileye","domain": "mobileye.com", "region": "eu" }
]}
```

- `boardKey` = `source:token`, unique -- the queue, the ledger, auto-close and
  logos all key on it.
- Each source validates its own fields at load; a missing one is fatal, as
  today. The old `companies` list keeps loading as `greenhouse` boards during
  the move, so the switch is not a flag day.
- **One company, one source**: a company listed under two sources is a config
  error (Wayve is on both Greenhouse and Ashby) -- otherwise every posting
  would appear twice.

### Storage: a string job key, once

Today the key is `(boardToken, greenhouseJobId: long)` with a unique index.
Workday, Lever, Ashby and Comeet ids are strings. Generalise once, instead of
hashing strings into longs per source (the Workday plan's first idea -- this
plan replaces it):

- New fields on every row: `boardKey` (`greenhouse:wizinc`), `sourceJobId`
  (string), `source`.
- Migration, online and reversible: backfill the three fields on existing rows
  (`greenhouse:` + token, `greenhouseJobId.ToString()`), create the new unique
  index `(boardKey, sourceJobId)`, switch reads and writes, then drop the old
  index in a later release. Rows are never rewritten otherwise.
- The collection keeps its name (`greenhouse_jobs`) for now; renaming a
  collection with a vector index is a separate, optional step.

### Duplicates

Three layers, each exact, none guessing -- a duplicate card is harmless, a
hidden real job is not.

1. **In config: one domain, one board** (agreed 2026-09-26). Two boards with
   the same `domain` -- the same company on two sources, or mid-move between
   them -- is a fatal config error at load, like every other config mistake:
   `wayve.ai is listed on two boards (greenhouse:wayve, ashby:wayve)`. Nothing
   is fetched, nothing paid for. The domain is exact; company names are not.
2. **At ingest: exact duplicates stored hidden, never dropped.** A new posting
   whose content hash equals an open posting's on another board (a parent and a
   subsidiary listing the same role -- Intel and Mobileye, NVIDIA and an
   acquisition) is stored with `duplicate_of`, no embedding and no Claude
   reads -- so retrieval never returns it. When the visible copy closes, the
   hidden one is promoted on the same run, so the job never disappears while
   any copy is open. One batched `$in` per board run on a new `contentHash`
   index; it saves more reads than it costs.
3. **Not built: fuzzy matching.** Near-duplicate by similarity, or "same title
   and location", would hide one of two genuinely different openings with the
   same title. Only logged (similar vector + same title), and decided later on
   evidence.

### Politeness and failure, per source

- `SourceLimits` per source: concurrent requests, delay between pages,
  retry-with-backoff on 429/5xx. Greenhouse is a public API built for this;
  Workday is a careers site's own backend and gets 1 request at a time with a
  pause.
- **Per-board circuit breaker**: N consecutive failed runs (bot protection, a
  moved site -- Qualcomm left Workday) marks the board unhealthy in the ledger
  and logs loudly, instead of failing every day in silence. Its postings are
  not closed -- a broken fetch is still not an empty board.

### Observability

The run ledger gains `source`; `./batch.sh` and the log lines group by source.
One line per source per run: boards ok / failed, postings listed / skipped by
stage / detailed / stored. A failing source is visible the same day.

### Tests: one contract suite, run against every adapter

A parameterised suite every adapter must pass with its canned fixtures:

- a failed or partial listing throws or reports `Complete = false`;
- a detail failure skips that posting only, and nothing is closed for it;
- ids are stable across runs and unique across boards;
- dates map to `PostedAt` / `UpdatedAt` correctly (the age rule and "Posted"
  depend on it);
- content is cleaned the same way (the Greenhouse double-encoding lesson).

Adding a source = writing its fixtures and passing the suite.

### Discovery as a command

The probing done by hand on 2026-09-26 (which ATS a company uses, its token,
its Israel/UK engineering count) becomes `ingest discover "<company>"`: it
tries each source's lookup, verifies the board's company name, and prints a
ready-to-paste config entry with the measured counts. Choosing companies stops
being a research session.

## Phases

| # | What | Behaviour change | Size |
|---|---|---|---|
| 1 | `IJobSource` + `GreenhouseSource` wrapping today's `BoardClient`; `CompanyHandler` → `BoardHandler` calls the interface; contract suite over Greenhouse | none | 1-2 days |
| 2 | Storage key migration to `(boardKey, sourceJobId)` | none (verified by counts before/after) | 1 day |
| 3 | `boards.json` with `source`; old `companies` list still loads | none | 0.5 day |
| 4 | Two-stage prefilter in the handler (list → detail) | none for Greenhouse | 0.5 day |
| 5 | **Workday** adapter (docs/plans/workday-adapter.md, minus its id hash) | +10 companies, ~570 roles | 2-3 days |
| 6 | **Lever** (US + EU), then **Comeet** once measured, then **Ashby** | +more | 1 day each |
| 7 | `discover` command | tooling | 1 day |

Phases 1-4 change no behaviour and each ships alone, with production counts
compared before and after -- the refactor proves itself on the source that
already works before a new one depends on it.

## Open decisions

1. **Key migration (phase 2) vs. hashing ids per source.** Recommended:
   migrate. It is one careful day now instead of a workaround in every adapter.
2. **Config file**: rename to `boards.json` in phase 3, or keep
   `companies.json` with a `boards` section. Recommended: rename -- it no
   longer lists only Greenhouse companies.
3. **Order after Workday**: Lever (Mobileye alone is ~110) or measure Comeet
   first (16 Israeli companies). Recommended: measure Comeet during phase 5,
   decide then.
