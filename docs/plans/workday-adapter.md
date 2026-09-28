# Plan: the Workday adapter

Status: **built** (2026-09-28), no Workday board configured yet -- KLA is added
in its own change (Rollout). Revised the same day after phases 1-4 of
docs/plans/multi-source-ingest.md shipped and the API was probed again. Phase 5.
The first version (2026-09-26) predates the source interface and the string
key; what it proposed that is now settled differently is listed at the end.

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
Greenhouse companies give.

## The API, as measured on 2026-09-28

Public, undocumented, no key: what each careers site's own page calls.

- **List**: `POST https://{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
  with `{"appliedFacets":{...}, "limit":20, "offset":N, "searchText":""}`.
  A posting in the list is `title`, `externalPath`, `locationsText`,
  `postedOn`, `bulletFields` -- nothing else.
  - **`total` is on the first page only.** Every later page says `total: 0`
    (KLA: `[75, 0, 0, 0]`). Completeness is page one's total against the count
    collected over all pages.
  - **`total` is capped at 2000.** NVIDIA's whole site reports exactly 2000 and
    still returns a full page at offset 1980. A listing whose first-page total
    is 2000 cannot be proven whole, and is not treated as whole.
  - **Narrowing is by nested facet.** `locationMainGroup` groups
    `locationHierarchy1` (countries), `locations` (sites) and
    `locationHierarchy2` (type); the applied key is the nested one:
    `{"locationHierarchy1": ["<Israel id>", "<UK id>"]}`. NVIDIA narrowed to
    Israel + UK: **467** -- listable in full.
  - **The age is fuzzy.** `postedOn` is "Posted Today", "Posted 5 Days Ago",
    "Posted 30+ Days Ago" (44 of KLA's 75). No exact date in the list.
  - `locationsText` is a place ("Yavne, Israel") or a count ("2 Locations").
  - **A listed entry can be a stub**: `{"bulletFields": ["JR2018715"]}`, no title,
    no path (NVIDIA, 2026-09-28 -- gone again within the hour; a posting being
    unpublished). It counts in the total. Completeness is therefore the entries
    *returned* against the total; a stub is skipped and logged, never stored, and
    so never closed. The first build counted only usable ids, and one stub failed
    NVIDIA's whole run (fixed with the facts-version fix below).
- **Detail**: `GET https://{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}`
  returns `jobPostingInfo`: `title`, `jobDescription` (plain HTML, not
  entity-encoded), `location`, `additionalLocations` (when there are more),
  `startDate` (**the exact posting date**, `2026-09-28`), `jobReqId`,
  `jobPostingId` (the path's last segment), `externalUrl` (the apply link), `id`
  (a GUID). `hiringOrganization` is a legal entity ("Orbotech LTD"), so the
  display name comes from config.
- **Ids.** In the list, the only id is the path. `bulletFields` is a display
  field each tenant configures: on KLA it is the requisition id for 56 of 75
  postings, and for the other 19 the path ends in a repost suffix
  (`..._2640335-2`) that `bulletFields` does not show.

## Design

### A board

```json
{ "source": "workday", "token": "nvidia", "name": "NVIDIA", "domain": "nvidia.com",
  "host": "nvidia.wd5", "tenant": "nvidia", "site": "NVIDIAExternalCareerSite",
  "facets": { "locationHierarchy1": ["2fcb99c455831013ea52bbe14cf9326c", "2fcb99c455831013ea52f785717432d2"] } }
```

- `host`, `tenant`, `site` and `name` required for Workday, fatal at load when
  missing (as every config mistake is). `host` must be `<name>.wd<n>`, so a
  value cannot point the fetch at another domain.
- `facets` optional. KLA's `Israel` site needs none. For a whole-company site it
  narrows server-side, and it is what makes NVIDIA listable at all.
- Board key `workday:nvidia`; domain one-board rule unchanged.

### `WorkdaySource : IJobSource`

- **`ListAsync`**: pages of 20 in order, until a short page. Throws on any
  failed page (as Greenhouse does), and when the count collected differs from
  page one's total. A first-page total of 2000 is reported `Complete = false`:
  store what came back, close nothing, and log that the board needs facets.
  Each posting: id from the path, title, `locationsText` (a count like
  "2 Locations" is left out -- it names no place, so the filter reads it), no
  dates. `Detail` null: the detail is a separate request.
- **`DetailAsync`**: one GET; maps `startDate` to `PostedAt`,
  `location` + `additionalLocations` to the locations, `jobDescription` to the
  content, `externalUrl` to the apply link, `name` from config as the company.
  A failed request returns null: that posting is skipped this run and left
  open, as the handler already does.
- **Politeness** (`WorkdayLimits`): one request at a time for the source, one
  second between any two, up to 3 attempts with doubling backoff on 429/5xx
  (the site's Retry-After when given, capped at a minute). A careers site's own
  backend, not an API built for this. Requests identify themselves as
  `NextRole-ingest/1.0 (+https://nextrole.cloud)`, not as a browser.

### Through the existing pipeline

Phases 1-4 already do the rest:

- **Stage 1** (the listing) skips by location and function; the age rule
  passes, the listing has no date. **Stage 2** (the detail) has the exact date
  and full locations and applies the whole rule. So a 30+-days-old posting
  costs one detail request and nothing more.
- Cleaning, hashing, embedding, the Claude reads, the close diff: unchanged.

### Stored postings: not read while listed as before (revised 2026-09-28)

First built as "read every kept posting's detail daily": simple, and change
detection exact. Measured in production that made NVIDIA's run 13-15 minutes,
~9 of them re-reading ~312 stored postings, and the consumer handles one board
at a time -- so a user's triggered run waited behind it. A Workday listing
carries no edit date (checked: not in the listing, not in `jobPostingInfo`), so:

- A stored posting still listed with the same title and location text (a hash
  of the *listing's* own fields, `listing_signature` -- not the detail's, which
  names what the listing counts as "2 Locations") and read within 7 days is
  touched, not read. A changed title or location in the listing reads it that
  day.
- Each detail read stamps `detail_read_at`; after 7 days it is read again, which
  catches edits to the body alone -- the trade: those surface within a week,
  not a day. A first stamp is back-dated by a stable 0-6 days, so a board stored
  in one day comes due across the week, ~1/7 a day, not all on day 7.
- Only for postings whose detail is a request of its own; a Greenhouse listing
  carries the body, so nothing changes there.

With the too-old memory (docs/plans/two-stage-prefilter.md), NVIDIA's daily
detail reads fall from ~457 to its new postings plus ~45 weekly re-reads.

## Tests

`JobSourceContract` over canned Workday responses (list pages, details), plus:

- page one's total against the collected count; a failed middle page throws;
  a 2000 total is `Complete = false`;
- the detail's `startDate` becomes `PostedAt`; a failed detail is null;
- `externalPath` to id, including a repost suffix;
- config: missing `host`/`tenant`/`site`/`name` is fatal; a `host` that is not
  `*.wd<n>` is fatal; facets pass through to the request body;
- politeness: requests are sequential and a 429 is retried with backoff.

One opt-in integration test against KLA's real Israel site (75 postings).

## Rollout

1. Build. Verified against KLA's real Israel site by the opt-in
   `WorkdayLiveTests` (`GREENHOUSE_WORKDAY_LIVE=1`): the whole listing proven
   complete, a posting read in full with its exact date. No local ingest run:
   the pipeline around the source is the one already running in production.
2. Production: add KLA to `boards.json` in its own change, and read the filter,
   `to embed` and batch lines for that board.
3. Then NVIDIA with its facets, then the rest.

## Decisions (2026-09-28)

All three as recommended.

1. **The id: `jobPostingId` (the path's last segment, e.g.
   `Senior-Software-Engineer_2640335-2`).** Recommended. It is in the listing
   on every tenant, unique by construction (it is the posting's URL), and it is
   what the detail echoes back. The requisition id is not in the listing
   reliably (`bulletFields` is per-tenant display), and reposts share one. The
   cost: if Workday re-slugs a posting, it closes and returns as new -- one
   re-read.
2. **Narrowing: explicit `facets` per board in `boards.json`.** Recommended over
   the first plan's "pick facet values whose names match served locations at
   run time": the facet parameter differs per tenant (`locationHierarchy1` on
   NVIDIA), the match would be a guess by name, and a wrong guess silently
   lists nothing. The cost: a user in a city outside the facets never sees
   that company's postings there, which is the same trade as `served_locations`
   and is written next to the facet ids.
3. **Stored postings: detail read daily** (above). Recommended.

## Settled differently since the first version

- No id hash: the stored key is a string since phase 2.
- No `companies.json` list: a board is a `boards.json` entry since phase 3.
- The two-stage filter exists since phase 4; the adapter only leaves the
  listing's date empty and fills the detail's.
