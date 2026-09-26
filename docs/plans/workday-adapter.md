# Plan: the Workday adapter

Status: **plan**, 2026-09-26. Not built. Phase 5 of
docs/plans/multi-source-ingest.md -- build that plan's phases 1-4 first.

## Why

Measured 2026-09-26 against the companies of the retired LinkedIn pool, by each
company's own public careers site: Workday hosts the biggest Israeli
employers, and one adapter covers all of them.

| Company | Site (`host` / `site`) | Israel-located | of them engineering |
|---|---|---|---|
| NVIDIA | `nvidia.wd5` / `NVIDIAExternalCareerSite` | 425 | 391 |
| KLA | `kla.wd1` / `Israel` (an Israel-only site) | 76 | 49 |
| Applied Materials | `amat.wd1` / `External` | 60 | 39 |
| Intel | `intel.wd1` / `External` | 21 | 17 (looks low -- check for a separate Israel site, as KLA has) |
| Motorola Solutions | `motorolasolutions.wd5` / `Careers` | 12 | 9 |
| F5 | `ffive.wd5` / `f5jobs` | 5 | 4 |

About 500 Israel engineering roles -- NVIDIA alone is half of what all 20
Greenhouse companies give. Qualcomm has left Workday (careers.qualcomm.com);
Palo Alto Networks and NetApp run their own sites; Mobileye is on Lever (EU) --
the next adapter, not this one.

## The API (public, undocumented)

What each careers site's own page calls. No key.

- **List**: `POST https://{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
  with `{"appliedFacets":{}, "limit":20, "offset":N, "searchText":""}` returns
  `{ total, jobPostings[], facets[] }`. A posting in the list has only
  `title`, `externalPath`, `locationsText` ("Yavne, Israel", or "3 Locations"),
  a fuzzy `postedOn` ("Posted 30+ Days Ago") and `bulletFields` (the req id).
  **20 per page, no bigger.**
- **Detail**: `GET https://{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}`
  returns `jobPostingInfo`: `id` (a hex GUID), `jobReqId`, `title`,
  `startDate` (**the exact posting date**, "2026-09-23"), `location`,
  `additionalLocations`, `country`, `timeType`, `externalUrl` (the apply link),
  `jobDescription` (HTML). `hiringOrganization.name` is the legal entity
  ("4050 ORBK LTD Israel"), so the display name comes from config.
- **Facets**: the list response names the site's facets (`locationMainGroup`,
  `jobFamilyGroup`, ...). Their ids differ per tenant.

Undocumented means it can change without notice, and a tenant can add bot
protection. Both must fail loudly (below), never quietly empty a board.

## Design

### Fit into the existing pipeline, don't fork it

The Greenhouse pipeline -- hash skip, close diff, pre-read filter, embeddings,
facts, parse on first score, triggers, auto-close, Matches -- is keyed on
`(boardToken, greenhouseJobId: long)` with a unique index, and consumes
`BoardJob`. The adapter produces `BoardJob`s and stores into the same
collection, so everything downstream works unchanged.

- **Board token**: `wd-nvidia`, `wd-kla` -- a prefix that cannot collide with a
  Greenhouse slug. Passes `CompaniesConfig`'s token rule (letters, digits,
  `-`, `_`) as is.
- **Job id** -- *superseded by docs/plans/multi-source-ingest.md*, which
  migrates the stored key to `(boardKey, sourceJobId: string)` once for every
  source, so Workday stores `jobReqId` as is and needs no hash. The original
  idea, kept for the record: `greenhouseJobId` is a `long`. Workday's are strings (`id` GUID,
  `jobReqId`). Map to a stable 63-bit hash of `"{tenant}:{jobReqId}"` (first 8
  bytes of SHA-256, sign bit cleared), and store the original as
  `source_job_id` for debugging. Collision odds across a few thousand postings
  are ~1e-12; the unique index would reject one loudly rather than merge two.
  *Alternative rejected for now*: generalise the key to a string -- cleaner,
  but it migrates a unique index and every stored row for no user-visible gain.
  Revisit if a third source makes the hash feel like a workaround.
- **`source`** field: `"workday"` (Greenhouse rows keep `"greenhouse"`).

### Config

A second list in `companies.json`, validated like the first:

```json
"workday": [
  { "token": "wd-nvidia", "name": "NVIDIA", "host": "nvidia.wd5", "tenant": "nvidia",
    "site": "NVIDIAExternalCareerSite", "domain": "nvidia.com" }
]
```

Fatal on a missing field or a token that collides with a Greenhouse one, like
every other config mistake. `publish` fans out both lists; the message carries
the token, and the consumer picks the client by prefix.

### Fetching (`WorkdayBoardClient : IBoardClient`)

1. **Narrow on the server, by location facet.** NVIDIA's whole site is
   thousands of postings; paging through all of them daily is 100+ requests
   for mostly out-of-scope roles. From the first page's `facets`, pick the
   location facet values whose names match served locations (Israel, United
   Kingdom, ...) and re-query with them applied. If no facet value matches,
   fall back to the whole site (correct, just slower) and log it.
2. **Page** 20 at a time, sequentially, with a short delay -- a careers site,
   not an API built for this. A browser-like `Accept: application/json`
   header (the root returns 406 without one).
3. **Guard: a failed fetch is not an empty board.** Any page failing throws;
   the collected count must equal `total`, or it throws (the same rule as
   Greenhouse's `meta.total`). Control never reaches the close diff.
4. **Detail only for postings not stored.** Stored ones are present-in-list =
   touched (the hash skip's role). New ones get one detail request each,
   bounded concurrency (2-3). A detail failure skips that posting this run --
   it is retried next run, and closing is driven by the list, so it cannot be
   closed by mistake.
5. **Map** detail to `BoardJob`: `Title`, `Location` (location +
   additional + country), `Offices` from additional locations, `Content` =
   `jobDescription` (through `ContentCleaner`; check whether Workday HTML is
   entity-encoded like Greenhouse's -- the cleaner handles both),
   `FirstPublished` = `startDate`, `UpdatedAt` = none, `AbsoluteUrl` =
   `externalUrl`, `CompanyName` from config.

### The pre-read filter, in two stages

The list has title and location but only a fuzzy age; the exact date is in the
detail. So:

- **Stage 1, on the list (before any detail request):** location and function
  (`Prefilter.Decide` without the age rule). "3 Locations" resolves to
  nothing and is read -- unknown never hides. This also saves detail requests.
- **Stage 2, after the detail (before embedding or any Claude read):** the age
  rule with the exact `startDate`.

### Change detection -- a known trade

Greenhouse re-hashes every posting's content daily for free. Workday would need
a detail request per stored posting per day to do the same. Instead: a stored
posting present in the list is unchanged; its text is re-read only if its
**title** changed, or on a weekly sweep of details. Workday descriptions rarely
change after posting; the sweep bounds how stale one can get. Recorded here as
a knowing gap, not a silent one.

## Tests (the silent failures first)

- A page failing mid-way throws; collected != `total` throws -- the close diff
  never runs on a partial list.
- A detail failure skips that posting only; nothing is closed for it.
- Stage 1 skips on location/function without a detail request; stage 2 skips
  on age with the exact date.
- The id hash is stable across runs and differs across tenants.
- Config: missing field, token collision, bad host -- all fatal.
- Facet fallback: no matching location value -> whole site, logged.

Driven with canned list/detail JSON through `StubHandler`, as the Greenhouse
tests are; one opt-in integration test against a real small site (KLA's
Israel site, ~76 postings).

## Rollout

1. Build, with the filter's existing check lines and the audit sample question
   still open (new sources have the same blind spot as new boards).
2. Local: `wd-kla` only (~76 postings, Israel-only site) -- small and fast.
3. Production: KLA first, then NVIDIA (the big one), then the rest, reading the
   skip and check lines per board, as with the Greenhouse batches.

## Estimate

3-5 days, most of it in the fetch guards, the two-stage filter and their
tests. Ask before building if the id hash, the weekly-sweep trade or the
location-facet narrowing should go differently.
