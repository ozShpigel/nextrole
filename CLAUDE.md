# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# All services via Docker
export ANTHROPIC_API_KEY=your-key-here
export MONGODB_CONNECTION_STRING=mongodb://...
docker compose up --build

# Individual .NET services
dotnet run --project JobMatchService/src/Api
dotnet run --project ApplicationTracker/src/Api
dotnet run --project EmailSync

# JobDiscovery (Python)
cd JobDiscovery && pip install -r requirements.txt && uvicorn app.main:app --port 5137

# Build entire solution
dotnet build job-application-platform.sln

# Frontend
cd frontend && npm install && npm run dev
```

There are no test projects in this repo currently.

## Architecture

Monorepo with 5 loosely-coupled services communicating over HTTP:

- **JobMatchService** (ASP.NET Core 10, port 5136) — AI-powered job matching. Owns the professional profile and scoring config in its own MongoDB collection (`profile` doc `{id: "default"}`). All Claude/Anthropic calls live here. Endpoints: `POST /api/match` (scores a job description; accepts optional pre-parsed title/company/etc. to skip the parse step), `GET|PUT /api/match/profile` (profile + scoring_config CRUD), `GET /health`. Prompt templates live in `Skills/` and `Templates/`.
- **ApplicationTracker** (ASP.NET Core 10, port 5002) — CRUD API for job applications, interviews, notes, status updates, and statistics. Uses MongoDB.
- **EmailSync** (.NET 10 console app, no port) — One-shot process: fetches Gmail emails (labeled `JobApplications`, last 24h), parses them with Claude, and pushes status updates to ApplicationTracker. Run externally via cron/scheduler.
- **JobDiscovery** (Python FastAPI, port 5137) — Automated job discovery and orchestration only. Scrapes LinkedIn/Indeed using JobSpy, delegates AI scoring to JobMatchService (`POST /api/match`), stores search criteria + discovered jobs in MongoDB, dedupes against and auto-saves qualifying matches to ApplicationTracker. **No Claude SDK, no prompts, no profile here.**
- **Frontend** (React 19 + Vite, port 3000) — Hebrew RTL SPA. Nginx reverse-proxies `/api/match` to JobMatchService, `/api/applications|stats|interviews|notes` to ApplicationTracker, and `/api/discovery` to JobDiscovery. Settings page reads/writes profile + scoring_config via `/api/match/profile`.

Each .NET service follows a three-layer structure: `src/Api` (entry point + endpoints), `src/Core` (domain models + interfaces), `src/Infrastructure` (external integrations).

## Key Environment Variables

- `ANTHROPIC_API_KEY` / `Anthropic__ApiKey` — Claude API key (used by JobMatchService and EmailSync)
- `MongoDB__ConnectionString` — MongoDB connection string (JobMatchService, ApplicationTracker)
- `MongoDB__Database` — JobMatchService DB name (defaults to `jobmatch`)
- `Tracker__BaseUrl` — Tracker URL used by EmailSync
- `MONGODB_CONNECTION_STRING` — MongoDB connection string (JobDiscovery)
- `APPLICATION_TRACKER_BASE_URL` — Tracker URL used by JobDiscovery
- `JOB_MATCH_SERVICE_URL` — JobMatchService URL used by JobDiscovery for AI scoring
- `JOB_MATCH_SERVICE_URL`, `APPLICATION_TRACKER_URL`, `JOB_DISCOVERY_URL` — Nginx upstream URLs for frontend proxy
- `CORS_ORIGINS` / `CorsOrigins` — Comma-separated allowed browser origins. Used by JobDiscovery (`CORS_ORIGINS`) and by JobMatchService + ApplicationTracker (`CorsOrigins`). Defaults to `*`; set to the public frontend URL in production so the SPA can call each service directly.
- `VITE_JOB_DISCOVERY_URL`, `VITE_JOB_MATCH_SERVICE_URL`, `VITE_APPLICATION_TRACKER_URL` — Build-time args (GitHub Actions repo variables of the same name). When set, the SPA calls that service directly from the browser instead of through the nginx reverse-proxy. Leave empty for local `docker compose` so the proxy fallback is used.

## CI/CD

Each service has a separate GitHub Actions workflow (`.github/workflows/`) with path-based triggers. Pushes to `main` build Docker images, publish to `ghcr.io`, and deploy to Render via webhook. .NET services target 10.0; JobDiscovery uses Python 3.12.

## Inter-Service Communication

- JobDiscovery → JobMatchService: delegates AI job scoring via `POST /api/match`
- JobDiscovery → ApplicationTracker: dedup checks and saves qualifying discovered jobs via HTTP
- JobDiscovery → LinkedIn/Indeed: scrapes jobs via JobSpy
- JobMatchService → Claude API: parses + evaluates jobs
- EmailSync → ApplicationTracker: reads active applications and posts status updates via HTTP
- EmailSync → Gmail: reads emails via Google Gmail API
- EmailSync → Claude API: parses emails into status updates
- Frontend (Nginx) → JobMatchService, ApplicationTracker, JobDiscovery: reverse proxy
