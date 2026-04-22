# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# All services via Docker
export ANTHROPIC_API_KEY=your-key-here
export MONGODB_CONNECTION_STRING=mongodb://...
docker compose up --build

# Individual .NET services
dotnet run --project API/src/Api
dotnet run --project Mailbot

# Scraper (Python)
cd Scraper && pip install -r requirements.txt && uvicorn app.main:app --port 5137

# Build entire solution
dotnet build job-application-platform.sln

# Frontend
cd frontend && npm install && npm run dev
```

There are no test projects in this repo currently.

## Architecture

Monorepo with 3 loosely-coupled services communicating over HTTP:

- **API** (ASP.NET Core 10, port 5002) — Unified backend. Owns CRUD for applications/interviews/notes/status/stats AND AI-powered job matching. All Claude/Anthropic calls live here. The professional profile and scoring config are stored in a separate Mongo database (`jobmatch` by default — see `MongoDB:Database`) from the application tracking data (`job-tracker` by default — see `MongoDB:DatabaseName`). Endpoints include: `POST /api/match` (scores a job description; accepts optional pre-parsed title/company/etc. to skip the parse step), `GET|PUT /api/match/profile` (profile + scoring_config + prompt overrides CRUD), `POST /api/applications`, `GET /api/applications`, `GET /api/applications/exists`, status/interview/note/stats/timeline endpoints, and `GET /health`. Prompt seeds live in `API/src/Infrastructure/AI/PromptSeeds.cs`; the professional profile seed lives in `API/Data/professional-profile.md`.
- **Mailbot** (.NET 10 console app, no port, folder `Mailbot/`) — One-shot process: fetches Gmail emails (labeled `JobApplications`, last 24h), parses them with Claude, and pushes status updates to the API. Run externally via cron/scheduler. Self-contained namespace (`Mailbot.*`) — no project reference to the API.
- **Scraper** (Python FastAPI, port 5137, folder `Scraper/`) — Automated job discovery and orchestration only. Scrapes LinkedIn/Indeed using JobSpy, delegates AI scoring to the API (`POST /api/match`), stores search criteria + discovered jobs in MongoDB, dedupes against and auto-saves qualifying matches to the API. **No Claude SDK, no prompts, no profile here.**
- **Frontend** (React 19 + Vite, port 3000) — Hebrew RTL SPA. Nginx reverse-proxies `/api/match`, `/api/applications|stats|interviews|notes` to the API, and `/api/discovery` to the Scraper. In production the SPA can call each service directly via `VITE_*` env vars, bypassing nginx entirely (see the build-time args below).

The API follows a three-layer structure: `src/Api` (entry point + endpoints), `src/Core` (domain models + interfaces), `src/Infrastructure` (MongoDB repos, Claude client, profile provider).

## Key Environment Variables

- `ANTHROPIC_API_KEY` / `Anthropic__ApiKey` — Claude API key (used by API and Mailbot)
- `MongoDB__ConnectionString` — MongoDB connection string (API — one connection, two databases)
- `MongoDB__DatabaseName` — application tracking DB name (defaults to `job-tracker`)
- `MongoDB__Database` — job-match profile DB name (defaults to `jobmatch`)
- `Tracker__BaseUrl` — API URL used by Mailbot
- `MONGODB_CONNECTION_STRING` — MongoDB connection string (Scraper)
- `API_BASE_URL` — Unified API URL used by the Scraper for both AI scoring (`/api/match`) and tracker writes (`/api/applications/exists`, `/api/applications`)
- `API_URL`, `SCRAPER_URL` — Nginx upstream URLs for frontend proxy
- `CORS_ORIGINS` / `CorsOrigins` — Comma-separated allowed browser origins. Used by the Scraper (`CORS_ORIGINS`) and by the API (`CorsOrigins`). Defaults to `*`; set to the public frontend URL in production so the SPA can call each service directly.
- `VITE_SCRAPER_URL`, `VITE_API_URL` — Build-time args (GitHub Actions repo variables of the same name). When set, the SPA calls the corresponding service directly from the browser instead of through the nginx reverse-proxy. Leave empty for local `docker compose` so the proxy fallback is used.

## CI/CD

Each service has a separate GitHub Actions workflow (`.github/workflows/`) with path-based triggers. Pushes to `main` build Docker images, publish to `ghcr.io`, and deploy to Render via webhook. .NET services target 10.0; the Scraper uses Python 3.12.

## Inter-Service Communication

- Scraper → API: delegates AI job scoring via `POST /api/match`, dedup checks via `GET /api/applications/exists`, saves qualifying discovered jobs via `POST /api/applications`
- Scraper → LinkedIn/Indeed: scrapes jobs via JobSpy
- API → Claude API: parses + evaluates jobs
- Mailbot → API: reads active applications and posts status updates via HTTP
- Mailbot → Gmail: reads emails via Google Gmail API
- Mailbot → Claude API: parses emails into status updates
- Frontend (Nginx) → API, Scraper: reverse proxy
