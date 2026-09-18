# Getting Started

Full setup for [NextRole](../README.md) — running the stack with Docker or per-service, the optional integrations, and every environment variable.

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download) — API, Mailbot, Seeder
- [Python 3.12+](https://www.python.org/) — Scraper
- [Bun](https://bun.sh/) — frontend runtime & package manager
- A [MongoDB](https://www.mongodb.com/) instance (Atlas free tier works)
- An [Anthropic API key](https://console.anthropic.com/)
- [Docker](https://www.docker.com/) (optional — for the all-in-one path)
- A Google Cloud OAuth client (optional — only for the mailbot/Gmail sync)

## Option A — Docker Compose (all services)

```bash
export ANTHROPIC_API_KEY=your-key-here
export MONGODB_CONNECTION_STRING=mongodb://your-connection-string

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

Ports: client `:3000`, API `:5002`, scraper `:5137`.

## Option B — Run the core locally (minimum setup)

The app runs on just a MongoDB connection string + an Anthropic key. The scraper and mailbot are optional.

```bash
# API — match + tracking (http://localhost:5002)
MongoDB__ConnectionString="<your-mongo-uri>" Anthropic__ApiKey="sk-ant-..." \
  dotnet run --project server/api/src/Api

# Client (http://localhost:5173)
cd client && bun install && bun run dev
```

## Optional services

```powershell
# Scraper — Python FastAPI on :8000 (PowerShell for venv activation)
cd server/scraper
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

```bash
# Mailbot — one-shot Gmail sync (skips cleanly if no Gmail credentials)
dotnet run --project server/mailbot

# Build the whole .NET solution
dotnet build nextrole.sln
```

## Environment variables

The Mongo connection string and the Anthropic key are read **only** from the environment — never hardcoded. `.env.example` templates are provided for the [API](../server/api/src/Api/.env.example), [Scraper](../server/scraper/.env.example), and [Mailbot](../server/mailbot/.env.example); copy to `.env` and fill in. ASP.NET maps `__` in env-var names to config `:` (e.g. `MongoDB__ConnectionString` → `MongoDB:ConnectionString`).

> **Minimum to run:** the API needs only `MongoDB__ConnectionString` + `Anthropic__ApiKey`; the Scraper needs nothing (it holds no credential). Everything else is optional with sensible defaults.

### API (ASP.NET Core)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MongoDB__ConnectionString` | **yes** | — | MongoDB connection string |
| `Anthropic__ApiKey` | **yes** | — | Claude API key |
| `MongoDB__DatabaseName` | no | `job-tracker` | Application-tracking DB |
| `MongoDB__ProfileDatabase` | no | `jobmatch` | Profile/scoring DB |
| `CorsOrigins` | no | `""` (none) | Comma-separated allowed browser origins; `*` for dev |
| `Scoring__*`, `Prompts__Analyzer`, `Prompts__Evaluator` | no | see `appsettings.json` / `PromptSeeds.cs` | Read-only scoring config & prompt overrides |

### Scraper (Python FastAPI)

A jobspy adapter: search parameters in, listings out. It holds **no
credential** — no database, no API key, no identity — because a service that
parses hostile HTML should not hold either (`docs/scraper-slimming.md`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ORIGINS` | no | `*` | Comma-separated allowed browser origins. Vestigial: the browser does not call this service. |

It serves `POST /scrape`, `POST /scrape/url` and `/health`, and is called by
`PoolIngest` and the API over Docker DNS.

**Scheduled ingest.** The daily run is `PoolIngest`, a .NET cron container
(`server/api/Dockerfile.poolingest`), not this service. It reads
`server/api/src/PoolIngest/config/roles.json`, calls `POST /scrape` here, folds
the results into the shared pool, and exits non-zero on failure so a bad night
is visible in whatever job history your scheduler keeps. `0 5 * * *` is the
reference cadence; see `deploy/systemd/nextrole-pool-ingest.*`.

### Mailbot (.NET console, optional) & Frontend

The mailbot reads config from env vars or a local `.env`. It does **not** need an Anthropic key — email parsing happens in the API.

| Variable | Service | Required | Description |
|----------|---------|----------|-------------|
| `Tracker__BaseUrl` | Mailbot | no (`http://localhost:5002`) | API URL the mailbot posts updates to |
| `Gmail__CredentialsPath` | Mailbot | no | OAuth client-secrets JSON; **if absent, mailbot skips and exits cleanly** |
| `Gmail__LookbackDays` | Mailbot | no (`3`) | Daily-sync search window; the query is built from tracked-company names |
| `Gmail__Query` | Mailbot | no (built automatically) | Optional verbatim override of the daily-sync Gmail query |
| `Mailbot__Resync` | Mailbot | no (`false`) | `true` → next run re-syncs from full history instead of the daily 24h sync |
| `Mailbot__ResyncCompany` / `Mailbot__ResyncTitle` | Mailbot | no | Scope re-sync to one company/role; if unset, re-sync all |
| `API_URL` / `SCRAPER_URL` | Frontend (Nginx) | no | Upstream URLs for the reverse proxy |
| `VITE_API_URL` / `VITE_SCRAPER_URL` | Frontend (build arg) | no | Direct-call URLs baked into the SPA (bypass nginx) |
