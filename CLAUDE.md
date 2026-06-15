# NextRole — Claude Code Guide

## Project Overview

NextRole is a job application platform that automates the job hunting process
end-to-end. It discovers job listings from sites like LinkedIn and Indeed, uses AI
to score and match them against your professional profile, monitors your email for
application updates, and provides a dashboard to track everything — from discovery
through interviews to final status — in one place. See `project-scope.md` and `implementation-plan.md` for full detail.

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | ASP.NET Core (C#) · Python FastAPI |
| Frontend | React + Vite + shadcn/ui + Tailwind CSS v4 |
| Database | MongoDB Atlas |

## Project Structure

```
/client          - React + Vite
/server/api      - ASP.NET Core
/server/scraper  - Python FastAPI
/server/mailbot  - .NET Console App (C#)
```

## Running Locally

```bash
cd client && bun run dev # Vite on :5173
cd server/api/src/Api && dotnet run # ASP.NET Core on :5002
```

```powershell
# Scraper — Python FastAPI on :8000 (PowerShell for venv activation)
cd server/scraper; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Key Conventions

- Use TypeScript throughout the frontend
- Use Bun as the runtime and package manager (not npm/yarn)
- Use shadcn/ui components for all UI (import from @/components/ui/*)
- Use shadcn's semantic color tokens (e.g. bg-background, text-muted-foreground, text-destructive) instead of hardcoded Tailwind colors
- Use Axios for HTTP requests (not fetch)
- Use TanStack React Query (useQuery, useMutation) for server state management (not useEffect + useState)
- Use context7 MCP server to fetch up-to-date documentation for libraries
- All Claude/Anthropic AI calls live exclusively in the API — the Scraper delegates scoring via HTTP
- Mailbot is a one-shot process (run via cron/scheduler), not a long-running service
- Frontend is an English LTR SPA using shadcn/ui components with the default neutral theme
- AI prompts use system/user separation: trusted instructions in the API system prompt field, untrusted external data (job descriptions, emails) in the user message wrapped in XML tags
- `scoring_config` keys are validated against an allowlist before persisting to MongoDB
- `GET /api/applications` returns a lightweight `ApplicationListItem` projection (only the fields the tracker/dashboard render) — the full `Application` document is fetched per-application via `GET /api/applications/{id}`. Status updates patch the React Query list cache optimistically (`setQueryData`) instead of refetching the list

## Scoring Pipeline

Each job scoring = 2 Claude API calls: Analyst (Haiku) + Evaluator (Sonnet with extended thinking).

- **Scoring config** is stored in MongoDB `profile` collection (doc id: "default"), loaded with 30s cache — no API restart needed for config changes
- **Custom evaluator prompt** stored in DB overrides the system prompt in `PromptSeeds.cs`
- **Scoring dimensions**: Technical Fit (35pts), Engineering Execution Fit (30pts), Sustainability & Pace Fit (35pts)
- **Sub-component breakdown**: each dimension's `breakdown.<dim>.components[]` array (modeled by `ScoreComponent` in `MatchResponse.cs`) splits its score into sub-criteria, each with `name`, `score`, `maxScore`, and a one-sentence `reason` — Technical Fit → Core Stack (0-20) + System Design (0-15); Engineering Execution → Development Practices/Role Clarity & Ownership + Engineering Maturity; Sustainability & Pace → Work-Life + Communication/Pace + Growth/Long-term Risk. Dimension score = sum of its components; surfaced in the discovery UI via the "Score Breakdown" button on each job card, alongside a "Signals" summary (recommendation green/red flags)
- **Verdicts**: STRONG_YES, YES, MAYBE, NO, STRONG_NO, INSUFFICIENT_DATA
- **Auto-save to tracker**: jobs with YES/STRONG_YES verdict, OR score >= `min_score_to_save` with `shouldApply=true`
- **Parallel scoring**: 5 concurrent jobs via `asyncio.Semaphore`
- **JSON resilience**: `ClaudeClient.cs` has lenient deserializers, fence/brace extraction, comment stripping, and auto-retry with "return ONLY JSON" nudge
- **Evaluator request**: streamed (keeps the connection alive on long generations), `max_tokens` 8192 (4096 truncated large verdict JSON → MATCH_FAILED), with prompt caching on the static system prompt (`PromptCacheType.AutomaticToolsAndSystem`)

### Scoring modes: live vs batch

A discovery run has a `mode` (`live` | `batch`). The live path (UI "Discover now") scores each job synchronously via `POST /api/match`. The **batch path** (cron) runs the Analyst live but defers the Evaluator to the Anthropic **Message Batches API** (50% cheaper, async, no quality change):

- **API endpoints** (Claude calls stay in the API): `POST /api/match/parse` (analyst-only → `ParsedJob`), `POST /api/match/batch` (parsed jobs → submit evaluator batch → `batchId`), `GET /api/match/batch/{id}` (poll; once `ended`, per-`customId` verdict/score with the same verdict-band correction the live path applies). `ClaudeClient` wraps the SDK Batches API and parses the results JSONL; `JobMatchService` shares parse + correction between both paths.
- **Scraper** (`orchestrator.py`): `run_discovery_batch` (phase 1: scrape → dedup → enrich → analyst live → submit batch → `awaiting_batch`) and `finalize_batches` (phase 2: poll ready batches → write scores back → auto-save qualifying → `completed`).
- **One cron** drives it: `POST /api/discovery/run-batch-cycle/{criteria_id}` does **collect-then-submit** (finalize the previous batch, then submit a new run). Results land at the next firing (~next day). Also: `POST /api/discovery/run/{id}?mode=batch` (submit-only) and `POST /api/discovery/finalize-batches` (collect-only).
- **Run statuses** (batch): `pending → scraping → parsing → awaiting_batch → finalizing → completed`. The startup orphan-reconciler in `main.py` skips `awaiting_batch` (it legitimately spans restarts; the batch id is persisted) but fails it past ~26h (Anthropic batches expire at 24h). Batch jobs don't carry `evaluator_snapshot_input` (the prompt is built server-side and not returned).


## Company Enrichment

The Scraper enriches each discovered job with external data before scoring:

- **Company News** — Google News RSS headlines (`news_client.py`). Passed to the evaluator prompt in `<company_news>` XML tags. AI reports green/red signals in `companyNewsAnalysis` (does not change numeric score).
- **Glassdoor Rating** — scraped from DuckDuckGo search snippets (`glassdoor_client.py`). Passed in `<glassdoor_rating>` XML tags. AI factors it into the cultural fit narrative.
- **Company Summary** — on-demand AI-generated Hebrew summary (3-4 lines) of what the company does, including approximate employee count. Generated via `POST /api/applications/{id}/company-summary` using Claude's knowledge base (no external data). Persisted on the `Application` document.

Both news and Glassdoor are prefetched in parallel after scraping, cached per company within a discovery run, and stored on the `DiscoveredJob` document. If either fetch fails, scoring proceeds normally without it.

## On-demand AI (application detail)

Generated per-application from the tracker detail page and persisted on the `Application` document:

- **Company Summary** — see above (`POST /api/applications/{id}/company-summary`).
- **"Why work here?" answer** — a personalized single Hebrew paragraph answering the interview question. Combines the user's profile + interview-prep self-presentation (trusted, in the system prompt) with the job/company context — description, company summary, news, Glassdoor (untrusted, XML-wrapped in the user message). Generated via `POST /api/applications/{id}/why-work-here` (`ClaudeClient.GenerateWhyWorkHereAsync`, one-shot Sonnet), stored in the `WhyWorkHere` field.

## Interview Prep

Standalone interview-prep content the user authors on the dedicated `/interview-prep` page, separate from scoring config. Stored under an `interview_prep` sub-object on the same `profile`/`default` doc.

- **Fields**: `self_presentation_hr`, `self_presentation_technical`, `presenting_work_project`, `presenting_personal_project` (free text), and `qa_rubric` (managed list of `{question, answer}`).
- **Endpoints**: `GET/PUT /api/match/interview-prep` plus `GET /api/match/interview-prep/history/{field}` and `POST .../history/{field}/restore`, reusing the profile version-history machinery. Writes use a partial `$set`, so the scoring fields are never touched.
- The self-presentations feed the "why work here?" generation as trusted context.
- **Keyword cues (rehearsal mode)**: each self-presentation field has a Full text ⇄ Keywords toggle. Keywords mode shows an ordered list of short cue lines (Claude distills the prose via `ClaudeClient.GeneratePresentationCuesAsync` / `PromptSeeds.PresentationCues`, JSON `{cues:[…]}`) so the user speaks from memory instead of reading verbatim. Cues are **cached per saved version**: stored on the `interview_prep` doc as `self_presentation_hr_cues` / `self_presentation_technical_cues`, generated on first view and served without a Claude call thereafter. `POST /api/match/interview-prep/cues` takes `{field, force}`, reads the *saved* text server-side, and short-circuits when a cached set exists (`force` regenerates). Saving changed text drops that field's cues (`CarryCues` in `UpsertInterviewPrepAsync` carries them forward only when the text is unchanged); the next view regenerates. The cue lines render `dir="rtl"` (RTL list items) for clean mixed Hebrew/English bidi.

## Mailbot (Email Sync)

One-shot process: pulls active applications from the API, parses last-24h Gmail messages via `POST /api/emails/parse` (Claude, `PromptSeeds.EmailParser`), and applies status/interview updates.

- **Matching** — an email is matched to an application by **company + job title**. The parser extracts a `jobTitle`; when several applications share a company, `MailbotOrchestrator.MatchApplication` disambiguates by title (exact → substring → token overlap), falling back to the first company match with a logged warning.
- **Interview idempotency** — the create-interview endpoint updates the existing auto-detected interview of the same type instead of inserting a duplicate (multiple emails in one scheduling thread each parse as `InterviewScheduled`). Scoped to interviews with `Notes == "Auto-detected from email"`; manual interviews are never merged.
## Testing

E2E tests use Playwright. Use the `e2e-test-writer` agent to write tests — it has the full setup details, database config, and conventions.

## Security

- CORS defaults to restrictive (empty) — set `CorsOrigins` env var explicitly
- `/api/match` is rate-limited (10 req/min fixed window) with 50K char max on job descriptions
- Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` headers