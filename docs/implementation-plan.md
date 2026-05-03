# NextRole — Implementation Plan

## Done

### Job Discovery
- [x] Search criteria CRUD (title, location, remote, results count, hours old, min score)
- [x] On-demand scraping runs via python-jobspy (LinkedIn, Indeed, Glassdoor)
- [x] Run timeline with real-time progress polling
- [x] Run detail page with discovered jobs sorted by score
- [x] Abort in-progress runs
- [x] Orphan run reconciliation on startup

### AI Scoring
- [x] Two-pass evaluation: analyst prompt → evaluator prompt
- [x] Claude scores each job against the user's professional profile
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
- [x] Professional profile editor (markdown)
- [x] Analyst and evaluator prompt customization
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
- [x] Render deployment

---

## Planned

### Notifications
- [ ] In-app notifications when high-scoring jobs are discovered
- [ ] Alerts on application status changes (from Mailbot)
- [ ] Notification preferences in settings

### Deduplication Fix
- [ ] Fix cross-run duplicate detection (currently buggy)

---

## Out of Scope
- **Auto-Apply** — Automated job applications on external sites (too unreliable across different platforms)
