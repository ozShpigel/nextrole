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

# Build entire solution
dotnet build job-application-platform.sln

# Frontend
cd frontend && npm install && npm run dev
```

There are no test projects in this repo currently.

## Architecture

Monorepo with 4 loosely-coupled services communicating over HTTP:

- **JobMatchService** (ASP.NET Core 10, port 5136) — AI-powered job matching. Accepts a job description, uses Claude (Anthropic SDK) to parse it and score it against the user's professional profile (`Data/professional-profile.md`). Prompt templates live in `Skills/` and `Templates/`. Can forward results to ApplicationTracker.
- **ApplicationTracker** (ASP.NET Core 10, port 5002) — CRUD API for job applications, interviews, notes, status updates, and statistics. Uses MongoDB (`mongodb` driver v3.2).
- **EmailSync** (.NET 10 console app, no port) — One-shot process: fetches Gmail emails (labeled `JobApplications`, last 24h), parses them with Claude, and pushes status updates to ApplicationTracker. Run externally via cron/scheduler.
- **Frontend** (React 19 + Vite, port 3000) — Hebrew RTL landing page. Nginx reverse-proxies `/api/match` to JobMatchService and `/api/applications|stats|interviews|notes` to ApplicationTracker.

Each .NET service follows a three-layer structure: `src/Api` (entry point + endpoints), `src/Core` (domain models + interfaces), `src/Infrastructure` (external integrations).

## Key Environment Variables

- `ANTHROPIC_API_KEY` / `Anthropic__ApiKey` — Claude API key (used by JobMatchService and EmailSync)
- `MongoDB__ConnectionString` — MongoDB connection string (ApplicationTracker)
- `ApplicationTracker__BaseUrl` — Tracker URL used by JobMatchService
- `Tracker__BaseUrl` — Tracker URL used by EmailSync
- `JOB_MATCH_SERVICE_URL`, `APPLICATION_TRACKER_URL` — Nginx upstream URLs for frontend proxy

## CI/CD

Each service has a separate GitHub Actions workflow (`.github/workflows/`) with path-based triggers. Pushes to `main` build Docker images, publish to `ghcr.io`, and deploy to Render via webhook. All services target .NET 10.0.

## Inter-Service Communication

- JobMatchService → ApplicationTracker: saves match results via HTTP (`TrackerApiClient`)
- EmailSync → ApplicationTracker: reads active applications and posts status updates via HTTP (`TrackerApiClient`)
- EmailSync → Gmail: reads emails via Google Gmail API
- Frontend (Nginx) → JobMatchService, ApplicationTracker: reverse proxy
