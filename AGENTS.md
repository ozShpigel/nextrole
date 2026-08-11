# NextRole — Agent Guide

NextRole is a single-user job application platform that automates the job hunt end-to-end: it discovers listings from LinkedIn/Indeed, scores every one against the user's profile with AI at ingest time, monitors Gmail for application updates, and tracks everything — discovery through interviews — in one dashboard. See `project-scope.md` and `implementation-plan.md` for full detail.

## Stack & structure

| Path | What |
|---|---|
| `/client` | React + Vite + shadcn/ui + Tailwind v4 (TypeScript, Bun) |
| `/server/api` | ASP.NET Core (C#) — **all Claude/Anthropic calls live here** |
| `/server/scraper` | Python FastAPI — scraping, ingest-time AI scoring |
| `/server/mailbot` | .NET console app — one-shot Gmail sync (cron), not a service |

Database: MongoDB Atlas.

## Running locally

```bash
cd client && bun run dev # Vite on :5173
cd server/api/src/Api && dotnet run # ASP.NET Core on :5002
```

```powershell
# Scraper — Python FastAPI on :8000 (PowerShell for venv activation)
cd server/scraper
.\.venv\Scripts\python.exe -m uvicorn app.main:app `
  --host 0.0.0.0 --port 8000 --reload
```

## Hard conventions

- Frontend: TypeScript everywhere; **Bun** (not npm/yarn); shadcn/ui components (`@/components/ui/*`); **Axios** (not fetch); **TanStack React Query** for server state (not useEffect + useState).
- **Never hardcode Tailwind palette colors** (emerald/amber/red…). Use design tokens: `--ed-*` inside editorial pages, shadcn semantic tokens in neutral/shared chrome (nav, portaled dialogs). Theme spec + portal caveat: `docs/design-system.md`.
- The frontend is English LTR, but content can be mixed Hebrew RTL (AI summaries, interview text) — render those nodes with `dir="rtl"`/`dir="auto"`.
- All Claude/Anthropic calls live in the API; the scraper delegates via HTTP.
- AI prompts use system/user separation: trusted instructions in the system prompt; untrusted external data (job descriptions, emails, scraped titles) XML-wrapped in the user message.
- `scoring_config` + the agent prompts are **read-only server configuration** (Options pattern, env overrides, change = redeploy). The candidate **profile is the user-editable input** — stored as `StructuredProfile`, rendered to the `content` string prompts consume; **never hand-edit `content`**. Keep prompts generic/objective; candidate signal comes only from the injected profile. Detail: `docs/scoring-and-search.md`.
- **Single-tenant, no auth (intentional).** Public exposure = private instance + seeded demo instance. `DemoMode=true` 403s writes via an allowlist middleware — **new mutating endpoints must be allowlisted in `Program.cs` / `main.py` to work in demo**. Never set `ApiKey` on the demo. Detail: `docs/demo-mode.md`; ops: `docs/hosting-a-public-demo.md`.
- Use the context7 MCP server to fetch up-to-date library documentation.

## Working agreement

When two instructions conflict, stop and ask — don't pick one silently.

## UI rules

NextRole is a scanning tool, not a reading surface. The match score
carries the visual weight; typography stays quiet.

- Dark is the only theme. Don't add a light mode or a theme toggle.
- Flat surfaces only. Exception: `.editorial-grain`/`.home-atmosphere` are intentional ambient layers on Landing/Home. Everywhere else: no gradients, no shadows, no glow.
- Use tokens from `client/src/index.css` only. Never hardcode hex.
- `--ed-accent` marks the primary action or the active state of a control. One per view.
- The score ramp is for any 0-100 or rated score (match score, interview score, per-dimension sub-scores). Never for status or category.
- Error and destructive states keep their color (`--ed-no`). Everything else that isn't a primary action or a score stays neutral.
- Two font weights: 400, 500.
- Display face (`--font-serif`, Schibsted Grotesk) is for the wordmark and empty-state copy only. Page titles and section headers use sans with weight.
- Type scale: 40 / 16 / 13. No other sizes.
- RTL: mixed Hebrew content (AI summaries, interview text) gets `dir="rtl"`/`dir="auto"` on those nodes — see `docs/design-system.md`. Physical `pl-`/`pr-`/`ml-`/`mr-` elsewhere, not logical properties.

## Feature docs (read when working in that area)

| Area | Doc |
|---|---|
| Scoring pipeline, ingest-time batched scoring, title triage, company enrichment, on-demand AI | `docs/scoring-and-search.md` |
| Editorial Broadsheet theme (tokens, page pattern, portal caveat, status colors) | `docs/design-system.md` |
| Tracker list projection + Applications tab buckets | `docs/tracker.md` |
| Generate Pack — AI-tailored résumé PDF per application | `docs/resume-pack.md` |
| Interview prep, Q&A rubric, keyword cues, mock interview | `docs/interview-prep.md` |
| Mailbot (Gmail sync, parsing rules, resync, OAuth) | `docs/mailbot.md` |
| Demo mode, ApiKey gate, seeder | `docs/demo-mode.md` |

## Testing

- **Unit/component**: Vitest + Testing Library (`cd client && bunx vitest run`). Tests query by text/role/testid — preserve those when restyling. Editorial restyles must keep heading roles (e.g. `AnalysisCard`'s "AI Analysis" stays an `<h3>`, asserted by an e2e `getByRole('heading')`).
- **E2E**: Playwright in `/e2e` (`npx playwright test`, use `--reporter=line` to avoid the HTML report server hanging). Use the `e2e-test-writer` agent to **write** tests — it has the full setup, DB config, and conventions.
- **Running e2e locally — stop your dev servers first.** Playwright's `webServer` config sets `reuseExistingServer` when not CI, so if your dev servers are up on :5002/:8000/:5173 it runs the suite against them (your dev `job-tracker` DB) instead of spawning its own against the **test** DBs (`job-tracker-test`/`jobmatch-test`, which `global-setup` drops). Gotcha: a uvicorn `--reload` reloader can survive a task kill and hold :8000 in *Bound* (not *Listen*) state — a `-State Listen` port check won't see it; find/kill the python PID directly.
- **After a "restart", verify the process actually runs the new code** — both dev servers have survived intended restarts (day-old PIDs kept serving :8000/:5002, silently executing old code). Cheap probes: scraper → `GET :8000/openapi.json` should list the endpoint you're testing; API → hit the endpoint with `{}` — a **404** where you expect a **400** means the old build. If stale, `Get-NetTCPConnection -LocalPort <port>` → `taskkill /PID <pid> /T /F`, then relaunch.
- **Hebrew in PowerShell 5.1 looks like mojibake (`××ª×...`) — it's the console, not the data.** `Invoke-RestMethod` decodes JSON responses without a charset header as ISO-8859-1. The wire bytes are valid UTF-8 (the browser renders fine); recover a captured string with `s.encode('latin-1').decode('utf-8')` if you need to read it in a script.

## Security

- CORS defaults to restrictive (empty) — set `CorsOrigins` env var explicitly
- Rate-limit buckets (`Program.cs`): `match` (10/min — manual "Score a Job" page, normalize, interview-prep cues) and `discovery` (20/min — the batched ingest-time scoring endpoint `/api/match/discovery-score-batch`, kept separate so a big discovery run never starves the manual page). 50K char max on job descriptions.
- Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` headers
