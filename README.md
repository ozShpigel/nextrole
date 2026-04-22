# Job Application Platform

An AI-powered toolkit for managing your entire job search — from discovering opportunities to tracking applications. Built as a monorepo with a unified React frontend.

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
                   │      API        │ │  JobDiscovery   │
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
                 │  EmailSync   │                    │
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
| **JobDiscovery** | Python FastAPI | 5137 | Scrape LinkedIn/Indeed via JobSpy, delegate scoring to the API, auto-save matches |
| **EmailSync** | .NET 10 Console | — | One-shot process: fetch Gmail, parse with Claude, push status updates to the API |
| **Frontend** | React 19 + Vite | 3000 | Hebrew RTL SPA with Nginx reverse proxy |

## Features

- **AI Job Matching** — Paste any job description and get a detailed compatibility score with strengths, concerns, and an honest assessment powered by Claude
- **Automated Job Discovery** — Define search criteria (titles, locations, values, preferences) and let the system scrape LinkedIn/Indeed, score results with AI, and auto-save qualifying matches
- **Application Tracking** — Full lifecycle tracking: applications, interviews, notes, status updates, and dashboard statistics
- **Email Sync** — Automatically detect application status changes from Gmail and update the tracker
- **Unified Dashboard** — Hebrew RTL interface with a warm dark theme, accessible navigation, and responsive design

## Prerequisites

- [Docker](https://www.docker.com/) (recommended)
- [.NET 10 SDK](https://dotnet.microsoft.com/download) (for running .NET services locally)
- [Python 3.12+](https://www.python.org/) (for running JobDiscovery locally)
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

# Email Sync (one-shot)
dotnet run --project EmailSync

# Job Discovery
cd JobDiscovery
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

| Variable | Used By | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` / `Anthropic__ApiKey` | API, EmailSync | Claude API key |
| `MongoDB__ConnectionString` | API | MongoDB connection string |
| `MongoDB__DatabaseName` | API | Application tracking DB (default `job-tracker`) |
| `MongoDB__Database` | API | Profile/scoring DB (default `jobmatch`) |
| `MONGODB_CONNECTION_STRING` | JobDiscovery | MongoDB connection string |
| `APPLICATION_TRACKER_BASE_URL` | JobDiscovery | API URL for dedup + save |
| `JOB_MATCH_SERVICE_URL` | JobDiscovery | API URL for AI scoring (same as `APPLICATION_TRACKER_BASE_URL`) |
| `Tracker__BaseUrl` | EmailSync | API URL for status updates |
| `APPLICATION_TRACKER_URL` | Frontend (Nginx) | Upstream URL for API proxy |
| `JOB_DISCOVERY_URL` | Frontend (Nginx) | Upstream URL for discovery proxy |

## Project Structure

```
job-application-platform/
├── API/                          # Unified backend (matching + tracking)
│   ├── Data/
│   │   └── professional-profile.md
│   ├── Dockerfile
│   └── src/
│       ├── Api/                  # Entry point + endpoints
│       ├── Core/                 # Domain models + interfaces (Matching, Profile, Models)
│       └── Infrastructure/       # MongoDB repos, Claude client, profile provider
├── JobDiscovery/                 # Scraping + orchestration (Python)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── models/
│       └── services/
├── EmailSync/                    # Gmail sync console app
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
| `application-tracker.yml` | `API/**` | `ghcr.io/ozshpigel/application-tracker` |
| `job-discovery.yml` | `JobDiscovery/**` | `ghcr.io/ozshpigel/job-discovery` |
| `email-sync.yml` | `EmailSync/**` | `ghcr.io/ozshpigel/email-sync` |
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
