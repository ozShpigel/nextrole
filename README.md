# Job Application Platform

An AI-powered toolkit for managing your entire job search — from discovering opportunities to tracking applications. Built as a microservices monorepo with a unified React frontend.

## Architecture

Five loosely-coupled services communicate over HTTP, fronted by a single-page React app with Nginx reverse proxy:

```
                         ┌──────────────────┐
                         │  Frontend (React) │  :3000
                         │  Nginx reverse    │
                         │  proxy + SPA      │
                         └────┬────┬────┬────┘
                              │    │    │
              ┌───────────────┤    │    ├───────────────┐
              ▼               ▼    │    ▼               │
   ┌──────────────────┐ ┌─────────┴────────┐ ┌────────┴─────────┐
   │  JobMatchService  │ │ ApplicationTracker│ │   JobDiscovery    │
   │  ASP.NET Core 10  │ │ ASP.NET Core 10   │ │  Python FastAPI   │
   │  :5136            │ │ :5002              │ │  :5137            │
   └──────┬───────────┘ └──────┬────────────┘ └──┬──────┬────────┘
          │                     │                  │      │
          │  Claude API         │  MongoDB         │      │ Claude API
          │  (Anthropic)        │                  │      │ (Anthropic)
          └─────────────────────┼──────────────────┘      │
                                │                          │
                         ┌──────┴──────┐            ┌─────┴──────┐
                         │   MongoDB    │            │  LinkedIn   │
                         │              │            │  Indeed     │
                         └──────┬──────┘            │  (JobSpy)   │
                                │                    └────────────┘
                         ┌──────┴──────┐
                         │  EmailSync   │
                         │  .NET Console│
                         │  (cron)      │
                         └──────┬──────┘
                                │
                         ┌──────┴──────┐
                         │   Gmail API  │
                         └─────────────┘
```

### Services

| Service | Stack | Port | Purpose |
|---------|-------|------|---------|
| **JobMatchService** | ASP.NET Core 10 | 5136 | Paste a job description, get an AI-powered fit score against your professional profile |
| **ApplicationTracker** | ASP.NET Core 10 | 5002 | CRUD for applications, interviews, notes, status tracking, and statistics |
| **JobDiscovery** | Python FastAPI | 5137 | Scrape LinkedIn/Indeed via JobSpy, score each listing with Claude, auto-save matches |
| **EmailSync** | .NET 10 Console | — | One-shot process: fetch Gmail, parse with Claude, push status updates to tracker |
| **Frontend** | React 19 + Vite | 3000 | Hebrew RTL SPA with Nginx reverse proxy to all backend services |

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
- [MongoDB](https://www.mongodb.com/) instance (ApplicationTracker and JobDiscovery)
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
# Job Match Service
dotnet run --project JobMatchService/src/Api

# Application Tracker
dotnet run --project ApplicationTracker/src/Api

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
| `ANTHROPIC_API_KEY` / `Anthropic__ApiKey` | JobMatchService, EmailSync, JobDiscovery | Claude API key |
| `MongoDB__ConnectionString` | ApplicationTracker | MongoDB connection string |
| `MONGODB_CONNECTION_STRING` | JobDiscovery | MongoDB connection string |
| `ApplicationTracker__BaseUrl` | JobMatchService | Tracker URL for saving match results |
| `APPLICATION_TRACKER_BASE_URL` | JobDiscovery | Tracker URL for saving discovered jobs |
| `Tracker__BaseUrl` | EmailSync | Tracker URL for status updates |
| `JOB_MATCH_SERVICE_URL` | Frontend (Nginx) | Upstream URL for job match proxy |
| `APPLICATION_TRACKER_URL` | Frontend (Nginx) | Upstream URL for tracker proxy |
| `JOB_DISCOVERY_URL` | Frontend (Nginx) | Upstream URL for discovery proxy |

## Project Structure

```
job-application-platform/
├── JobMatchService/              # AI job matching service
│   ├── Dockerfile
│   └── src/
│       ├── Api/                  # Entry point + endpoints
│       ├── Core/                 # Domain models + interfaces
│       └── Infrastructure/       # External integrations (Claude, HTTP)
├── ApplicationTracker/           # Application tracking service
│   ├── Dockerfile
│   └── src/
│       ├── Api/
│       ├── Core/
│       └── Infrastructure/       # MongoDB integration
├── JobDiscovery/                 # Job discovery + scoring service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI app + endpoints
│       ├── config.py             # Settings (pydantic-settings)
│       ├── models/               # Pydantic data models
│       ├── services/             # Scraper, scorer, orchestrator
│       └── prompts/              # Claude scoring prompt template
├── EmailSync/                    # Gmail sync console app
│   └── Dockerfile
├── frontend/                     # React SPA
│   ├── Dockerfile
│   ├── nginx.conf                # Reverse proxy config
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx               # Shell layout + navigation
│       ├── main.jsx              # Routes
│       ├── components/           # Modal, ErrorBoundary, etc.
│       ├── pages/                # Landing, Match, Discovery, Tracker
│       ├── styles/               # CSS (global, landing, discovery, etc.)
│       └── utils/                # API wrappers, formatters
├── docker-compose.yml
├── job-application-platform.sln  # .NET solution file
└── .github/workflows/            # CI/CD per service
```

## CI/CD

Each service has its own GitHub Actions workflow (`.github/workflows/`) with path-based triggers:

- Push to `main` affecting a service's directory triggers only that service's pipeline
- Builds Docker images and publishes to `ghcr.io`
- Deploys to Render via webhook

| Workflow | Trigger Path | Image |
|----------|-------------|-------|
| `job-match-service.yml` | `JobMatchService/**` | `ghcr.io/ozshpigel/job-match-service` |
| `application-tracker.yml` | `ApplicationTracker/**` | `ghcr.io/ozshpigel/application-tracker` |
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
- Anthropic Python SDK
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
