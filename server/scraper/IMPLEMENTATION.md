---
title: Scraper (jobspy adapter)
applies_to:
  - "server/scraper/**"
owner: "@ozShpigel"
stability: "stable"
priority: 3
last_verified: "2026-09-18"
interfaces:
  http: "POST /scrape, POST /scrape/url, GET /health (also /api/discovery/health)"
  graphql: ""
  grpc: ""
  events_out: []
  events_in: []
  cli: []
  jobs: []
data_owned: []
deps_internal: []
deps_external: ["LinkedIn via python-jobspy"]
tests_hint: ["server/scraper/tests/**"]
runbook: "docs/deploying.md"
---

# Scraper

A jobspy adapter. Search parameters in, listings out.

It connects to no database, resolves no identity, makes no outbound calls and
holds no credential. Every decision the daily run makes — what is new, what to
keep, what to extract, what to age out — belongs to `PoolIngest`, and every
user-scoped route belongs to the API.

This file was 208 lines describing five responsibilities. Four of them moved
(`docs/scraper-slimming.md`). What is left is 503 lines of code, so a long
document about it would be describing something you could simply read.

## The line it must not cross

**It holds no credential, and nothing here should introduce one.** A service
whose job is parsing hostile HTML should not also hold `readWrite` on two
production databases — it did until Phase 3d, and removing that was the point of
the exercise. If something here needs a database or a user, it belongs in the
API or in `PoolIngest` instead.

## Endpoints

| | |
|---|---|
| `POST /scrape` | every (title × location) pair, paced. Returns `{jobs, stats}` |
| `POST /scrape/url` | one posting by URL. Returns `{"job": null}` on failure |
| `GET /health`, `GET /api/discovery/health` | liveness |

Neither scrape endpoint is reachable from a browser: nginx proxies only what
the client uses, and these are called container-to-container over Docker DNS by
`PoolIngest` and the API.

`/scrape/url` answers `{"job": null}` rather than a 404 on a failed fetch. A bad
link, an expired posting and a changed page structure are ordinary outcomes, not
faults of this service, and a 404 would be ambiguous with a missing route.

## What is worth knowing

`app/services/scraper.py` is the whole of it, and it holds hard-won jobspy
knowledge that is easy to lose in a rewrite:

- **`_correct_is_remote`** — jobspy's own heuristic substring-matches a keyword
  list against the description, so a posting saying "Remote type - Office"
  reads as remote. This corrects it.
- **NaN handling** — jobspy builds one DataFrame per job and drops all-NA
  columns, so a field's absence and its emptiness look different by row.
- **`fetch_job_by_url`** imports from `jobspy.linkedin.util` and `jobspy.model`
  directly. Private, and the reason the jobspy version is pinned.

**Pacing is not politeness theatre.** Scraping is unauthenticated, so a block is
a per-IP 429 that jobspy swallows silently — `searches_failed`/`searches_empty`
in the response are the only evidence a run was throttled. The 8–20s sleep
between searches is why a full role list takes ~13 minutes, and why
`PoolIngest`'s HTTP timeout is 30 minutes rather than the 100-second default.

## Data

None. This service owns no collection and reads none.
