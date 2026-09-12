# NextRole — Implementation Plan

## Multi-user migration (2026-09)

Turning a single-tenant tool into a multi-user one, in seven steps. All seven
are complete on branch `multi-user`; the open items below are follow-ons, not
unfinished steps. Rules that outlive this work live in `AGENTS.md`; detail in
`docs/multi-user.md`, `docs/job-pool.md`, `docs/scoring-and-search.md`.

| # | Step | Status |
|---|---|---|
| 1 | Verify CV upload produces a structured profile | **Complete** — verification only, no code |
| 2 | `userId` on every user-scoped collection | **Complete** |
| 3 | Cookie identity | **Complete** |
| 4 | Shared job pool | **Complete** |
| 5 | Per-user, on-demand scoring | **Complete** |
| 6 | Role growth | **Complete** |
| 7 | Measure, then decide on vectors | **Complete** — decision: no vector DB |

### Step 1 — CV upload verified
Confirmed before any code was written: `POST /api/match/profile/normalize-file`
hands a PDF to Claude as a native document block and returns a **full
`StructuredProfile`** — `experience[]` with company, dates and highlights, plus
categorized `skills[]`, education, military service, side projects, spoken
languages and contact fields. Not stored text. Everything downstream could
therefore assume structured input.

Two findings from the same pass: the profile and résumé file were **hardcoded
singletons** (`id: "default"` / `_id: "current"`), which is what made Step 2 a
re-keying job rather than a field addition; and `Data/sample-profile.json` had
a stale `education` shape that threw on the bootstrap path (fixed in Step 2).

### Step 2 — `userId` on every user-scoped collection
Re-keyed the one-per-user documents to `_id = userId`; added a `UserId` field,
index and per-user unique constraint to the rest. Repositories take
`UserScopedCollection<T>`, which has no overload that omits the userId — so
scoping is a compile error rather than a convention, guarded by
`ArchitectureTests`. Migration stamps and re-keys existing data, never deletes,
and is fatal. `DbCopy` exists so it can be rehearsed against a copy of real data.

### Step 3 — Cookie identity
`uid` issued on a visitor's first request, unconditionally — which removes the
"has this visitor uploaded yet" branch everywhere. Minting creates no documents;
the first row is the CV upload. The API is the only issuer.

### Step 4 — Shared job pool
Daily `run-pool` over a config-driven role list. `pool_key` identity with a
unique index, inactive-on-absence (never deleted, including an exemption from
the retention TTL), and per-job extraction run once on entry with a bounded
retry.

### Step 5 — Per-user, on-demand scoring
Nothing is scored at ingest. The match tab narrows the pool with a cheap filter
over extracted facts and scores only what that user has never had scored,
capped per scan. Résumé packs capped at 3/user/day, claimed before the call.

### Step 6 — Role growth
A CV can add an uncovered role; a role leaves when its last user does;
`max_roles` caps the total. Spellings are canonicalized on the write path so a
capped list cannot fill with synonyms.

### Step 7 — Measure
One real run: **167 unique jobs** over the five baseline roles, ~$0.33 cold and
~$0.002/job for extraction. **No vector DB.** Two caveats recorded with the
number: every search hit `results_wanted` exactly (so 167 is parameter-bound,
not supply), and it is one 72-hour window against 60-day retention (steady state
nearer 600–2,500). See `docs/job-pool.md`.

### Open follow-ons
- [ ] Re-measure with `results_wanted=200` (Mon 2026-09-14) — whether the cap hid a materially larger pool, before the daily run goes unattended
- [ ] Retire the criteria-driven ingest path and `search_criteria` once nothing reads them
- [ ] Decide whether company enrichment belongs in the shared pool or the per-user path
- [ ] Deploy: `Identity:FixedUserId` is set-once and unchangeable without a second migration (`deploy/README.md`)

---

## Done

### Job Discovery
- [x] Search criteria CRUD (title, location, remote, results count, hours old, min score) — *superseded by the shared pool's config-driven role list; this path is pending retirement*
- [x] On-demand scraping runs via python-jobspy (LinkedIn, Indeed, Glassdoor) — *the daily `run-pool` ingest is now the primary path; LinkedIn only*
- [x] Run timeline with real-time progress polling
- [x] Run detail page with discovered jobs sorted by score
- [x] Abort in-progress runs
- [x] Orphan run reconciliation on startup

### AI Scoring
- [x] Two-pass evaluation: analyst prompt → evaluator prompt
- [x] Claude scores each job against the user's professional profile — *now per user and on demand (Step 5); ingest does not score*
- [x] Detailed reasoning with verdict (Strong Yes / Yes / Maybe / No / Strong No)
- [x] Rescore individual jobs on demand

### Company Enrichment
- [x] Google News RSS headlines per company
- [x] Glassdoor rating via DuckDuckGo search snippets
- [x] Parallel prefetch, cached per company within a run
- [x] Graceful degradation if either fetch fails

### Application Tracker
- [x] Save discovered jobs to tracker or add manually
- [x] Application list with status badges and match scores
- [x] Application detail page with full analysis
- [x] Status updates with transition history
- [x] Interview management (add/edit/delete, upcoming list)
- [x] Notes per application
- [x] Combined timeline view (status changes + interviews + notes)
- [x] Dismiss unwanted discovered jobs

### Dashboard
- [x] Stat cards: total apps, in-progress, avg score, response rate
- [x] Upcoming interviews
- [x] Recent activity feed

### Email Monitoring (Mailbot)
- [x] Gmail API integration with OAuth
- [x] Claude-powered email parsing (extract update type + company)
- [x] Auto-match emails to active applications by company
- [x] Auto-update application status and add notes
- [x] Scheduled one-shot execution (cron/task scheduler)

### Settings & Profile
- [x] Professional profile editor — *now a structured `StructuredProfile` populated by CV upload, not markdown*
- [x] Analyst and evaluator prompt customization — *superseded: prompts are read-only server configuration*
- [x] Scoring config (model, temperature, max tokens, thinking)
- [x] File-based fallback for profile

### Job Status Lifecycle
- [x] Statuses: Analyzing → DecidedToApply → Applied → PhoneScreen → TechnicalInterview → FinalRound → OfferReceived → Accepted / Rejected / Withdrawn
- [x] Status transition history with timestamps and notes

### Testing & Infrastructure
- [x] Playwright E2E tests (criteria, runs, jobs)
- [x] Nginx reverse proxy with security headers
- [x] CORS configuration
- [x] Rate limiting on /api/match (10 req/min)
- [x] Cross-run duplicate detection — fixed by the pool's unique `pool_key` index (was a check-then-act race)
- [x] Render deployment — *superseded: one Hetzner VPS via Docker Compose, see `deploy/README.md`*

---

## Planned

### Notifications
- [ ] In-app notifications when high-scoring jobs are discovered
- [ ] Alerts on application status changes (from Mailbot)
- [ ] Notification preferences in settings

---

## Out of Scope
- **Auto-Apply** — Automated job applications on external sites (too unreliable across different platforms)
