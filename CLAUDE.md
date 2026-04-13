# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# All services via Docker
export ANTHROPIC_API_KEY=your-key-here
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

- **JobMatchService** (ASP.NET Core 10, port 5136) — AI-powered job matching. Accepts a job description, uses Claude (Anthropic SDK) to parse it and score it against the user's professional profile (`Data/professional-profile.md`). Prompt templates live in `Skills/` and `Templates/`. Can forward results to ApplicationTracker.
- **ApplicationTracker** (ASP.NET Core 10, port 5002) — CRUD API for job applications, interviews, notes, status updates, and statistics. Uses MongoDB (`mongodb` driver v3.2).
- **EmailSync** (.NET 10 console app, no port) — One-shot process: fetches Gmail emails (labeled `JobApplications`, last 24h), parses them with Claude, and pushes status updates to ApplicationTracker. Run externally via cron/scheduler.
- **JobDiscovery** (Python FastAPI, port 5137) — Automated job discovery. Scrapes LinkedIn/Indeed using JobSpy, scores each job against the professional profile using Claude API, stores search criteria in MongoDB, and auto-saves qualifying matches to ApplicationTracker.
- **Frontend** (React 19 + Vite, port 3000) — Hebrew RTL SPA. Nginx reverse-proxies `/api/match` to JobMatchService, `/api/applications|stats|interviews|notes` to ApplicationTracker, and `/api/discovery` to JobDiscovery.

Each .NET service follows a three-layer structure: `src/Api` (entry point + endpoints), `src/Core` (domain models + interfaces), `src/Infrastructure` (external integrations).

## Key Environment Variables

- `ANTHROPIC_API_KEY` / `Anthropic__ApiKey` — Claude API key (used by JobMatchService and EmailSync)
- `MongoDB__ConnectionString` — MongoDB connection string (ApplicationTracker)
- `ApplicationTracker__BaseUrl` — Tracker URL used by JobMatchService
- `Tracker__BaseUrl` — Tracker URL used by EmailSync
- `MONGODB_CONNECTION_STRING` — MongoDB connection string (JobDiscovery)
- `APPLICATION_TRACKER_BASE_URL` — Tracker URL used by JobDiscovery
- `JOB_MATCH_SERVICE_URL`, `APPLICATION_TRACKER_URL`, `JOB_DISCOVERY_URL` — Nginx upstream URLs for frontend proxy

## CI/CD

Each service has a separate GitHub Actions workflow (`.github/workflows/`) with path-based triggers. Pushes to `main` build Docker images, publish to `ghcr.io`, and deploy to Render via webhook. .NET services target 10.0; JobDiscovery uses Python 3.12.

## Inter-Service Communication

- JobMatchService → ApplicationTracker: saves match results via HTTP (`TrackerApiClient`)
- EmailSync → ApplicationTracker: reads active applications and posts status updates via HTTP (`TrackerApiClient`)
- EmailSync → Gmail: reads emails via Google Gmail API
- JobDiscovery → ApplicationTracker: dedup checks and saves discovered jobs via HTTP
- JobDiscovery → Claude API: scores scraped jobs
- JobDiscovery → LinkedIn/Indeed: scrapes jobs via JobSpy
- Frontend (Nginx) → JobMatchService, ApplicationTracker, JobDiscovery: reverse proxy
