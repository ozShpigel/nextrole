# NextRole — AI-Powered Job Application Platform

## Problem
A job search spreads across many company career sites. Reading each posting to judge fit takes longer than the posting deserves, and keyword alerts flood you with roles that match a word but not the person. Once you apply, progress lives in scattered email threads and a spreadsheet you stop updating.

An AI that "reads the posting for you" only moves the problem: it scores generously, claims skills the CV never mentions, and ignores rules it was given. A score you cannot trust is worse than no score.

## Solution
Upload your CV. NextRole reads company job boards daily, scores every role against your CV, and tracks each application from first match to offer.

## Shape of the product

**Multi-user, one shared job pool.** A daily ingest reads company job boards
(Greenhouse, Workday, Lever and Comeet, `server/api/src/Greenhouse/config/boards.json`) into a
pool common to every user; scoring is per user and on demand. There is no
per-user scraping. LinkedIn scraping fed the pool until 2026-09-26 and is
retired.

**Global, English-only postings.** Anyone, anywhere, can upload a CV. What a
user sees depends on which companies are in `boards.json` and where they post:
the list is curated by hand, and the ingest keeps postings for every location
any user's profile names (`served_locations` plus `pool_locations`), so a CV
from a new city triggers a run that reads that city's postings within minutes.
The interface is English LTR and postings are expected in English —
user-authored content (AI summaries, interview text) can still be Hebrew RTL
and is rendered with `dir="auto"`.

**Identified by a cookie; an account is optional.** A visitor gets a `uid`
session cookie on their first request and uploads a CV; that is the whole
onboarding. Optional Google sign-in links that identity so it can be recovered
from another browser — it decides *which* identity you are, it does not replace
it (`docs/auth.md`).

**One deployment, two identity modes.** `nextrole.cloud` serves many users
(`Identity:Mode=Cookie`). `Fixed` mode serves a single configured user and is
what the offline eval CLIs run against; it had a hosted instance
(`private.nextrole.cloud`) until 2026-09-16. The two differ by configuration
only — see `docs/multi-user.md`.

## Features
- **Shared job pool** — a daily run over a config-driven list of company boards (RabbitMQ work queue, one message per board); unchanged postings skipped by content hash, postings no user could want skipped before any paid read, removed postings closed and never deleted (`docs/greenhouse.md`)
- **Per-job extraction** — required years, must/nice-to-have tech, seniority, job function, domain and location read once per posting, user-independently
- **Per-user matching** — a vector search over one embedding per posting plus filters on those facts narrows the pool, and only the survivors are scored against that user's profile; scores are stored per user, and every score is corrected server-side before it is stored (`docs/scoring-and-search.md`)
- **CV upload** — a PDF or TXT résumé becomes a structured profile (experience, categorized skills, education, side projects) via Claude
- **Company Enrichment** — company news and Glassdoor ratings enrich evaluations
- **Résumé Packs** — an AI-tailored résumé PDF per application, capped at 3 per user per day
- **Feature gating** — some features are visible but locked ("Coming soon"), enforced server-side by config (`docs/plans/feature-gating.md`)
- **Email Monitoring** — Gmail scanned for application updates, auto-updating status (single mailbox, gated as "Coming soon" for everyone else; see Deferred)
- **Application Dashboard** — every application from discovery through interviews to outcome
- **Interview Prep** — self-presentations, a Q&A rubric, mock interviews and retros

## Planned
- **Notifications** — alert on high-scoring jobs and status changes (email/push)
- **More ATS sources** — each a small adapter behind one contract (`docs/plans/multi-source-ingest.md`)
- **Email and passkey sign-in** — design only (`docs/auth.md`, Phase 2)

## Deliberately deferred

Each of these was considered and declined, with a reason. They are not backlog
by accident.

- **A separate vector database** — retrieval uses Atlas Vector Search in the database the app already runs on. For the LinkedIn pool (~600–2,500 postings) even that was declined in favour of a deterministic filter over extracted fields (`docs/job-pool.md`); the board ingest added one embedding per posting as a recall prefilter, never as a score (`docs/greenhouse.md`).
- **Gmail OAuth per user** — the mailbot reads one mailbox and writes as a single configured user. Multi-user mail would need per-user OAuth, token storage and refresh, which is a larger surface than the feature is worth today.
- **Passwords and account recovery beyond Google** — the session cookie is the identity; Google sign-in is the only way back to it from another browser.
- **A demo-persona path for unidentified visitors** — considered and withdrawn. An unidentified visitor is not shown someone else's seeded profile; they upload their own CV. (The seeded demo instance this once referred to has been retired.)

## Out of Scope
- **Auto-Apply** — automated applications on external platforms (too unreliable across sites)
