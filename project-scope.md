# NextRole — AI-Powered Job Application Platform

## Problem
Job hunting is fragmented and time-consuming — searching across multiple platforms, manually evaluating fit, and tracking applications through email threads and spreadsheets.

## Solution
An end-to-end job application platform that uses AI to discover matching jobs, evaluate them against your profile, and manage the process from discovery to final status.

## Shape of the product

**Multi-user, one shared job pool.** A daily ingest scrapes a configured role
list into a pool common to every user; scoring is per user and on demand. There
is no per-user scraping.

**Israel, English-only postings.** Searches run against Israeli listings. The
interface is English LTR and postings are expected in English — user-authored
content (AI summaries, interview text) can still be Hebrew RTL and is rendered
with `dir="auto"`.

**Identified by a cookie, not an account.** A visitor gets a `uid` cookie on
their first request and uploads a CV; that is the whole onboarding. No login, no
password, no recovery.

**Two deployments, one codebase.** `private.nextrole.cloud` serves a single
configured user; `nextrole.cloud` serves many. They differ by configuration
only — see `docs/multi-user.md`.

## Features
- **Shared job pool** — daily `jobspy` run over a config-driven role list (LinkedIn), deduplicated by URL or company+title+date, listings marked inactive when they stop appearing and never deleted
- **Per-job extraction** — required years, must/nice-to-have tech, seniority, domain and location read once per posting, user-independently
- **Per-user matching** — a cheap filter over those facts narrows the pool, and only the survivors are scored against that user's profile; scores are stored per user
- **CV upload** — a PDF or TXT résumé becomes a structured profile (experience, categorized skills, education, side projects) via Claude
- **Company Enrichment** — company news and Glassdoor ratings enrich evaluations
- **Résumé Packs** — an AI-tailored résumé PDF per application, capped at 3 per user per day
- **Email Monitoring** — Gmail scanned for application updates, auto-updating status (single mailbox; see Deferred)
- **Application Dashboard** — every application from discovery through interviews to outcome
- **Interview Prep** — self-presentations, a Q&A rubric, mock interviews and retros

## Planned
- **Notifications** — alert on high-scoring jobs and status changes (email/push)
- **Role growth follow-on** — real-time scraping when a new role joins the list (today it waits for the next daily run)

## Deliberately deferred

Each of these was considered and declined, with a reason. They are not backlog
by accident.

- **Vector DB / semantic retrieval** — measured: one run over the five baseline roles yields ~167 unique jobs, and the pool reaches roughly 600–2,500 in steady state. A deterministic filter over extracted fields is the right tool at that size; retrieval infrastructure starts earning its keep two orders of magnitude further up. Revisit only if the measured count approaches tens of thousands. (RAG was previously built and removed — it added retrieval-resolution and batch-composition failure modes the product did not need.) Detail: `docs/job-pool.md`.
- **Real-time scraping of a newly added role** — a CV revealing an uncovered role adds it to the list, but the pool fills on the next daily run rather than immediately. Accepted latency; scraping on demand would put an unbounded, user-triggered cost on a signup.
- **Gmail OAuth per user** — the mailbot reads one mailbox and writes as a single configured user. Multi-user mail would need per-user OAuth, token storage and refresh, which is a larger surface than the feature is worth today.
- **Real authentication** — no login, password, or account recovery. Identity is the `uid` cookie: clear it and the data is unreachable. A deliberate trade for a personal-scale tool, and the reason per-user data scoping is enforced structurally rather than by an auth layer.
- **A demo-persona path for unidentified visitors** — considered and withdrawn. An unidentified visitor is not shown someone else's seeded profile; they upload their own CV. (The seeded demo instance this once referred to has been retired.)

## Out of Scope
- **Auto-Apply** — automated applications on external platforms (too unreliable across sites)
