# Job Application Platform

An AI-powered toolkit for managing your entire job search — from discovering opportunities to tracking applications. Built as a monorepo with a unified React frontend.

## Single-tenant by design

This app is **single-tenant on purpose**: one user, **no authentication**. It is meant to run as
*your* private tool against *your* database. There is no login and no per-user data partitioning —
keep it that way.

To put it online safely, run **two separate instances of the same code**, each pointed at its own
MongoDB via the connection-string environment variable:

| Instance | MongoDB | `DemoMode` | Who |
|----------|---------|-----------|-----|
| **Private** (your real tool) | your real database | off | you only |
| **Public demo** | a *separate* database seeded with **fictional data only** | **on** | anyone |

The public demo runs in **read-only mode** (`DemoMode=true`): visitors can run AI analyses and browse
the seeded fictional data, but all job-tracker writes are disabled, so they can't pollute shared data.
Your real data lives only on the private instance — the demo's connection string must point at the
separate seeded demo database, never the real one.

See [DEMO_MODE](#demo-mode-public-read-only-demo), [Demo data seeding](#demo-data-seeding), and
[Run your own private copy](#run-your-own-private-copy).

## Architecture

Three loosely-coupled services communicate over HTTP, fronted by a single-page React app with Nginx reverse proxy:

```
                         ┌──────────────────┐
                         │  Frontend (React) │  :3000
                         │  Nginx reverse    │
                         │  proxy + SPA      │
                         └────┬─────────┬────┘
                              │         │
                              ▼         ▼
                   ┌────────────────┐ ┌────────────────┐
                   │      API        │ │    Scraper      │
                   │  ASP.NET Core 10│ │  Python FastAPI │
                   │  :5002          │ │  :5137          │
                   │  Match + Track  │ │  Scrape + Orch. │
                   └────┬───────────┘ └────┬──────┬─────┘
                        │                   │      │
              Claude API│ MongoDB           │      │ LinkedIn
              (Anthropic)│                  │      │ Indeed
                        │                   │      │ (JobSpy)
                 ┌──────┴──────┐            │      │
                 │   MongoDB    │◄───────────┘      │
                 │              │                    │
                 └──────┬──────┘                    │
                        │                            │
                 ┌──────┴──────┐                    │
                 │   Mailbot    │                    │
                 │  .NET Console│                    │
                 │  (cron)      │                    │
                 └──────┬──────┘                    │
                        │                            │
                 ┌──────┴──────┐                    │
                 │   Gmail API  │                    │
                 └─────────────┘                    │
                                                     │
                                              Claude API
```

### Services

| Service | Stack | Port | Purpose |
|---------|-------|------|---------|
| **API** | ASP.NET Core 10 | 5002 | Unified backend — AI job matching (paste a job description, get a fit score) **and** application/interview/note/status tracking with stats |
| **Scraper** | Python FastAPI | 5137 | Scrape LinkedIn/Indeed via JobSpy, delegate scoring to the API, auto-save matches |
| **Mailbot** | .NET 10 Console | — | One-shot process: fetch Gmail, parse with Claude, push status updates to the API |
| **Frontend** | React 19 + Vite | 3000 | Hebrew RTL SPA with Nginx reverse proxy |

## Features

- **AI Job Matching** — Paste any job description and get a detailed compatibility score with strengths, concerns, and an honest assessment powered by Claude
- **Automated Job Discovery** — Define search criteria (titles, locations, values, preferences) and let the system scrape LinkedIn/Indeed, score results with AI, and auto-save qualifying matches
- **Application Tracking** — Full lifecycle tracking: applications, interviews, notes, status updates, and dashboard statistics
- **Mailbot** — Automatically detect application status changes from Gmail and update the tracker
- **Unified Dashboard** — Hebrew RTL interface with a warm dark theme, accessible navigation, and responsive design

## Prerequisites

- [Docker](https://www.docker.com/) (recommended)
- [.NET 10 SDK](https://dotnet.microsoft.com/download) (for running .NET services locally)
- [Python 3.12+](https://www.python.org/) (for running the Scraper locally)
- [Node.js 20+](https://nodejs.org/) (for frontend development)
- [MongoDB](https://www.mongodb.com/) instance
- [Anthropic API key](https://console.anthropic.com/) (for AI features)

## Quick Start

### Docker Compose (all services)

```bash
export ANTHROPIC_API_KEY=your-key-here
export MONGODB_CONNECTION_STRING=mongodb://your-connection-string

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) to access the frontend.

### Run Services Individually

```bash
# API (match + tracking)
dotnet run --project API/src/Api

# Mailbot (one-shot)
dotnet run --project Mailbot

# Scraper
cd Scraper
pip install -r requirements.txt
uvicorn app.main:app --port 5137

# Frontend
cd frontend
npm install
npm run dev
```

### Build .NET Solution

```bash
dotnet build job-application-platform.sln
```

## Environment Variables

The Mongo connection string and the Anthropic key are read **only** from the environment — never
hardcoded. `.env.example` templates are provided for the API (`server/api/src/Api/.env.example`) and
the Scraper (`server/scraper/.env.example`); copy to `.env` and fill in. ASP.NET maps `__` in env var
names to config `:` (e.g. `MongoDB__ConnectionString` → `MongoDB:ConnectionString`).

**Minimum to run:** the API needs only `MongoDB__ConnectionString` + `Anthropic__ApiKey`; the Scraper
needs only `MONGODB_CONNECTION_STRING`. Everything else is optional with sensible defaults.

### API (ASP.NET Core)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MongoDB__ConnectionString` | **yes** | — | MongoDB connection string |
| `Anthropic__ApiKey` | **yes** | — | Claude API key |
| `DemoMode` | no | `false` | `true` = public read-only demo (tracker writes return 403) |
| `MongoDB__DatabaseName` | no | `job-tracker` | Application tracking DB |
| `MongoDB__Database` / `MongoDB__ProfileDatabase` | no | `jobmatch` | Profile/scoring DB |
| `CorsOrigins` | no | `""` (none) | Comma-separated allowed browser origins; `*` for dev |
| `Scoring__*`, `Prompts__Analyzer`, `Prompts__Evaluator` | no | see `appsettings.json` / `PromptSeeds.cs` | Read-only scoring config & prompt overrides |

### Scraper (Python FastAPI)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_CONNECTION_STRING` | **yes** | — | MongoDB connection string |
| `DEMO_MODE` | no | `false` | `true` = read-only (all scraper writes return 403) |
| `MONGODB_DATABASE_NAME` | no | `job-tracker` | Database name |
| `API_BASE_URL` | no | `http://localhost:5002` | Unified API URL (scoring, dedup, save) |
| `CRON_SECRET` | no | `""` (no guard) | Shared secret for cron-triggered endpoints |
| `CORS_ORIGINS` | no | `*` | Comma-separated allowed browser origins |

### Mailbot (.NET console, optional) & Frontend

The mailbot reads its config from environment variables or a local `.env`
(`server/mailbot/.env.example` template). It does **not** need an Anthropic key —
email parsing happens in the API.

| Variable | Service | Required | Description |
|----------|---------|----------|-------------|
| `Tracker__BaseUrl` | Mailbot | no (`http://localhost:5002`) | API URL for updates. Point at the **private** API (DemoMode off) — a demo API 403s writes |
| `Gmail__CredentialsPath` | Mailbot | no | OAuth client-secrets JSON; **if absent, mailbot skips and exits cleanly** |
| `Gmail__Query` | Mailbot | no (`label:JobApplications newer_than:1d`) | Gmail search for the daily sync |
| `Mailbot__Resync` | Mailbot | no (`false`) | `true` → next run re-syncs from full history instead of the daily 24h sync |
| `Mailbot__ResyncCompany` / `Mailbot__ResyncTitle` | Mailbot | no | Scope re-sync to one company/role; if unset, re-sync all applications |
| `API_URL` / `SCRAPER_URL` | Frontend (Nginx) | no | Upstream URLs for the reverse proxy |
| `VITE_API_URL` / `VITE_SCRAPER_URL` | Frontend (build arg) | no | Direct-call URLs baked into the SPA (bypass nginx) |

**Mailbot re-sync** (recover an interview/status beyond the 24h window): point
`Tracker__BaseUrl` at your private API, then either pass CLI args —
`dotnet run --project server/mailbot -- resync --company "Acme"` — or set
`Mailbot__Resync=true` (+ optional `Mailbot__ResyncCompany`) and run it. Requires
Gmail credentials; reconcile-only and idempotent.

## DEMO_MODE (public read-only demo)

Set `DemoMode=true` (API) and `DEMO_MODE=true` (Scraper) on the public instance. Effect:

- **Allowed:** all reads, plus non-persisting AI analyses — score a job (`POST /api/match`), profile
  normalize, mock-interview turn/debrief, email parse.
- **Blocked (HTTP 403):** every job-tracker write — create/update/delete applications, status, notes,
  interviews, profile/interview-prep edits, mock-session saves, and all scraper writes (discovery
  runs, criteria, job save/dismiss).
- The frontend reads `GET /api/config` and shows a "read-only demo" banner; blocked writes surface a
  friendly message.

Default is off, so your private/local instance behaves normally with full read/write.

## Demo data seeding

Populate a database with fictional demo data (the sample persona + a handful of fictional applications
across statuses). Point it at the **demo** database and run:

```bash
MongoDB__ConnectionString="<demo-db-uri>" dotnet run --project server/api/src/Seeder
```

It's idempotent (skips applications that already exist) and safe to re-run. Never run it against your
real database.

## Run your own private copy

```bash
git clone <this-repo> && cd job-application-platform

# API — needs only Mongo + an Anthropic key
MongoDB__ConnectionString="<your-mongo-uri>" Anthropic__ApiKey="sk-ant-..." \
  dotnet run --project server/api/src/Api          # http://localhost:5002

# Frontend
cd client && bun install && bun run dev            # http://localhost:5173
```

Optional: the Scraper (job discovery) and Mailbot (Gmail sync). Both degrade gracefully — the app runs
on just a Mongo connection string + an Anthropic key, and the Mailbot simply skips if no Gmail
credentials are configured. Leave `DemoMode` unset for full read/write.

## Project Structure

```
job-application-platform/
├── API/                          # Unified backend (matching + tracking)
│   ├── Data/
│   │   └── sample-profile.json   # fictional sample persona (seed)
│   ├── Dockerfile
│   └── src/
│       ├── Api/                  # Entry point + endpoints
│       ├── Core/                 # Domain models + interfaces (Matching, Profile, Models)
│       └── Infrastructure/       # MongoDB repos, Claude client, profile provider
├── Scraper/                      # Scraping + orchestration (Python)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── models/
│       └── services/
├── Mailbot/                      # Gmail sync console app
│   └── Dockerfile
├── frontend/                     # React SPA
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.js
│   └── src/
├── docker-compose.yml
├── job-application-platform.sln
└── .github/workflows/
```

## CI/CD

Each service has its own GitHub Actions workflow (`.github/workflows/`) with path-based triggers:

- Push to `main` affecting a service's directory triggers only that service's pipeline
- Builds Docker images and publishes to `ghcr.io`
- Deploys to Render via webhook

| Workflow | Trigger Path | Image |
|----------|-------------|-------|
| `api.yml` | `API/**` | `ghcr.io/ozshpigel/api` |
| `scraper.yml` | `Scraper/**` | `ghcr.io/ozshpigel/scraper` |
| `mailbot.yml` | `Mailbot/**` | `ghcr.io/ozshpigel/mailbot` |
| `frontend.yml` | `frontend/**` | `ghcr.io/ozshpigel/frontend` |

## Tech Stack

**Backend (.NET)**
- ASP.NET Core 10 (Minimal APIs)
- Anthropic SDK for .NET (Claude integration)
- MongoDB Driver v3.2
- Google Gmail API

**Backend (Python)**
- FastAPI + Uvicorn
- python-jobspy (LinkedIn/Indeed scraping)
- Motor (async MongoDB driver)
- pydantic-settings

**Frontend**
- React 19
- React Router v7
- Vite 6
- Nginx (production proxy)

**Infrastructure**
- Docker + Docker Compose
- GitHub Actions (CI/CD)
- GitHub Container Registry (`ghcr.io`)
- Render (hosting)
- MongoDB (database)
