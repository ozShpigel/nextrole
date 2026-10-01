<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/wordmark-dark.png">
  <img alt="NextRole" src="docs/images/wordmark-light.png" width="220" align="left">
</picture>
<br clear="left">

[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-blue)](LICENSE)

**NextRole finds the open roles that fit your CV — Claude judges every match, and code checks every judgement against your actual CV before you see it.**
For engineers anywhere: upload a CV, no signup, and get open roles from company job boards, read daily, ranked against your profile.
Every score passes 7 server-side checks, and an [eval harness](#2-golden-set-evaluation) runs the real scoring API against a 24-case hand-labelled golden set: 22/24, stable over 3 runs.
**Live at [nextrole.cloud](https://nextrole.cloud)** — in production on one VPS, deployed on every merge to `main`.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/pipeline-scene-dark.svg">
    <img src="docs/images/pipeline-scene-light.svg" width="760" alt="How NextRole works: ATS boards feed a shared pool every day; AI matching scores that pool against each candidate's résumé; Gmail tracks the replies, and matches go on to interview prep.">
  </picture>
</p>

## The problem

Matching a CV to a posting is a judgement, and an LLM makes it confidently and wrongly: it gave full marks for core stack to a candidate missing 12 required technologies, read the posting's requirements back as the candidate's own skills, and ignored score caps its prompt stated. A wrong score looks exactly like a right one, so nobody notices. The hard part of NextRole is not the CRUD around the model but making those failures impossible or visible.

## Architecture

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-dark.svg">
    <img src="docs/images/architecture-light.svg" width="900" alt="NextRole architecture: users, Gmail and company job boards on the left feed services on one Hetzner VPS (Caddy and the React app, the mail sync, and a RabbitMQ ingest of publisher, queue and consumer). Everything goes through the API, the only service that calls Claude: it retrieves with vector search, judges with the Claude Evaluator, verifies with seven server-side checks and generates validated résumé packs. On the right: Anthropic, Voyage embeddings and MongoDB Atlas.">
  </picture>
</p>

**The API is the only service that holds an Anthropic key.** The ingest ([`IngestAiClient.cs`](server/api/src/Core/Matching/IngestAiClient.cs)) and the mail worker call it over HTTP, so there is one prompt config, one key, and one set of rate limits ([`AGENTS.md`](AGENTS.md)).

| Layer | Choice |
|---|---|
| Backend | .NET 10, ASP.NET Core API + three .NET console workers ([`server/api/src`](server/api/src), [`server/mailbot`](server/mailbot)) |
| Frontend | React 19, Vite, TypeScript, Tailwind v4, shadcn/ui, TanStack Query ([`client`](client)) |
| Data | MongoDB Atlas with Atlas Vector Search; Voyage `voyage-4` embeddings, 1024 dimensions ([`GreenhouseEmbeddingOptions.cs`](server/api/src/Core/Greenhouse/GreenhouseEmbeddingOptions.cs)) |
| AI | Anthropic: Haiku 4.5 for fact extraction and scoring, Sonnet 5 for résumé packs and narrative enrichment ([`appsettings.json`](server/api/src/Api/appsettings.json)) |
| Queue | RabbitMQ: one message per company board, dead-letter queue ([`docs/greenhouse.md`](docs/greenhouse.md)) |
| Runtime | Docker Compose on one Hetzner VPS, Caddy for automatic HTTPS ([`deploy/compose.yml`](deploy/compose.yml), [`deploy/Caddyfile`](deploy/Caddyfile)) |

## Core principle: the model judges, code verifies

A model reads a posting well but doesn't reliably act on its own reasoning: it names a dealbreaker and still answers YES. So Claude writes the judgement, and code checks it against the CV and the posting, using data the model didn't write, before anyone sees it.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/pipeline-dark.svg">
    <img src="docs/images/pipeline-light.svg" width="900" alt="The path a posting takes, in five stages. Shared, once per posting: 01 Fetch (code): one call per board, unchanged postings skipped by SHA-256, never deletes, a failed fetch throws. 02 Filter (code): age, location and function before any paid call; 0 of 116 checked wanted roles hidden. 03 Extract (model): Claude Haiku, batched, closed vocabularies, once per posting for everyone. Per user, on demand: 04 Retrieve (code): vector search on your CV plus filters on the facts; only unscored postings reach a paid call. 05 Score and verify (model and code): Claude judges at temperature 0, then Correct() overrides it with 7 checks; 22/24 on the golden set.">
  </picture>
</p>

## How correctness is verified

Three layers, each catching what the one before it can't.

### 1. Code overrides the model

Every score passes through [`Correct()`](server/api/src/Core/Matching/JobMatchService.cs#L256) before it is stored. Each rule below started as an instruction in the prompt, was measured failing, and moved into code.

| The model… | So code… |
|---|---|
| ignored score caps its prompt stated | [recomputes the score](server/api/src/Core/Matching/JobMatchService.cs#L398) and clamps it |
| gave full marks for core stack to a candidate missing 12 required technologies | [works out the missing requirements itself](server/api/src/Core/Matching/ClaimGrounding.cs#L119), from the posting and the CV |
| credited the candidate with skills that were only in the posting | flags every claim about the candidate the CV doesn't support |
| named a dealbreaker and still answered YES | [forces STRONG_NO](server/api/src/Core/Matching/JobMatchService.cs#L273) on any real dealbreaker |
| invented dealbreakers from a posting's tone | [keeps only two kinds](server/api/src/Core/Matching/HardBlockerScope.cs#L24): the candidate's own, and work arrangement |

Tailored résumés get the same treatment, stricter, because they go to an employer: one that states a figure the CV never stated is [blocked](server/api/src/Core/Models/ResumePackValidator.cs). The blocking rule was measured on 53 real generations before it was switched on.

### 2. A golden set measures the scorer

An [eval harness](server/api/src/EvalHarness) sends [24 hand-labelled postings](server/api/src/EvalHarness/fixtures/golden-set.json) through the real scoring API against a fixed CV and compares the verdicts with the labels.

- **22/24**, stable across 3 runs at temperature 0. The recurring misses are documented case by case.
- A second eval checks that each sub-score (technical, execution, sustainability) lands in its expected band.

```bash
dotnet run --project server/api/src/EvalHarness -- verdict --runs 3
```

<!-- TODO: was the 22/24 baseline measured on Haiku? The fixture's labeledAt (2026-08-28) is after the Sonnet → Haiku switch (2026-08-11, ScoringConfig.cs:57), but the repo doesn't say which model ran it. -->
<!-- TODO: should each score store a trace keyed by prompt version and model? jobScores (JobScore.cs) stores neither; no ScoreTrace type exists. -->

### 3. Tests pin the failures that make no noise

| Suite | Tests | What it guards |
|---|---|---|
| [Architecture](server/api/tests/ArchitectureTests) | 242 | One user can never read another's data. Enforced by the type system ([`UserScopedCollection<T>`](docs/multi-user.md)), not by care. |
| [Ingest](server/api/tests/GreenhouseTests) | 303 | Failures that raise no error: a failed fetch closing a company's jobs, embeddings attached to the wrong posting. |
| [Frontend](client/src) | ~197 | Components and pages |
| [End-to-end](e2e/tests) | 5 Playwright specs | The main user flows, run locally. They need a billed API key, so they stay out of CI. |

The first three run on every pull request ([`tests.yml`](.github/workflows/tests.yml)).

## Decisions and trade-offs

| Decision | Why | What was rejected |
|---|---|---|
| Vector search inside MongoDB Atlas, used only as a recall filter before the Evaluator | Same database, no extra service. Cosine similarity decides which postings get a paid call, and is never shown as a score ([`docs/greenhouse.md`](docs/greenhouse.md)). | For the earlier LinkedIn pool (~600–2,500 postings), a vector DB was explicitly ruled out in favour of a deterministic filter over extracted fields ([`docs/job-pool.md`](docs/job-pool.md#L214)). TODO: was a separate vector database (e.g. Qdrant) evaluated for the Greenhouse source? Nothing in the repo records it. |
| Own identity layer: an opaque server-side session cookie, with optional Google sign-in only to recover the account | The `Guid` stays the identity, and sign-in only decides *which* Guid you are. No account is needed to use the product ([`docs/auth.md`](docs/auth.md)). | **Better Auth**: a TypeScript runtime the box doesn't have, and a second source of truth about users ([`docs/auth.md`](docs/auth.md#L519)). **ASP.NET Core Identity** is the *recommended* path for future email/passkey sign-in, not a rejected one ([`docs/auth.md`](docs/auth.md#L507)). |
| Feature gating in config: `Features.Status` (Free / ComingSoon / Paid) and per-user allowlists, enforced server-side | Few features, no billing yet; a config change plus a redeploy is enough ([`appsettings.json`](server/api/src/Api/appsettings.json), [`docs/plans/feature-gating.md`](docs/plans/feature-gating.md)) | `Microsoft.FeatureManagement` and any other new library |
| Ingest as cron-triggered console apps over RabbitMQ, not a background service in the API | A crash mid-company redelivers that company's message. Ingest load never competes with user requests. | A `BackgroundService` inside the API, rejected for resource competition, restart side-effects and double runs ([`docs/scraper-slimming.md`](docs/scraper-slimming.md#L88)) |
| Read company ATS boards directly instead of scraping LinkedIn | Completeness can be proven per board (`meta.total`). LinkedIn's storage was retired from the pool. | LinkedIn scraping through jobspy ([`docs/greenhouse.md`](docs/greenhouse.md)) |
| Haiku for the Evaluator | Cost: output tokens were $3.84 of $4.37 in one day's scoring spend ([`ScoringConfig.cs`](server/api/src/Core/Profile/ScoringConfig.cs#L57)). The server-side checks above don't depend on the model. | Sonnet for scoring. Sonnet is kept for résumé packs, where the output goes to an employer. |

## Running in production

- **Host:** one Hetzner VPS running Docker Compose ([`deploy/compose.yml`](deploy/compose.yml)).
  - Services: `caddy`, `web`, `api`, `rabbitmq`, `greenhouse-consumer`, `loki`, `promtail` and `grafana`.
  - Cron-profile jobs: `greenhouse` and `mailbot`.
- **TLS:** automatic HTTPS from Caddy for `nextrole.cloud` ([`deploy/Caddyfile`](deploy/Caddyfile)).
- **Schedules:** systemd timers in [`deploy/systemd`](deploy/systemd) run the Greenhouse publish at 06:15 UTC and the Gmail sync at 02:00 UTC.
- **CD:** each service has its own workflow in [`.github/workflows`](.github/workflows) (`api`, `frontend`, `mailbot`, `scraper`, `tests`). Each one tests the service, builds an image, pushes it to GHCR, then SSHes to the box and recreates only that service.
  - **Merging to `main` is the deploy.**
  - The ingest image is built from the same commit as the API, because both must use the same embedding model, and a mismatch returns no results silently.
- **Observability:**
  - Grafana, Loki and Promtail, with 14-day log retention ([`deploy/monitoring`](deploy/monitoring)).
  - A service health check and a daily digest, both alerting through Telegram ([`check-services.sh`](deploy/monitoring/check-services.sh), [`daily-digest.sh`](deploy/monitoring/daily-digest.sh)).
  - A run ledger for each ingest run.
- **Runbook:** [`docs/deploying.md`](docs/deploying.md) and [`docs/hosting.md`](docs/hosting.md), including least-privilege Atlas credentials per service.

## Local development

**Prerequisites:** Docker, a MongoDB connection string (the Atlas free tier works), an Anthropic API key and a Voyage API key. For working on one service: .NET 10 SDK, Bun, and Python 3 for the scraper.

**Env vars** (names only):
- Required: `ANTHROPIC_API_KEY`, `MONGODB_CONNECTION_STRING`, `VOYAGE_API_KEY`.
- Optional: `GREENHOUSE_BOARDS_CONFIG`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `JOBMATCH_MONGO_DB`, `MONGO_DB`.
- The full list is in [`docs/getting-started.md`](docs/getting-started.md) and [`deploy/.env.example`](deploy/.env.example).

```bash
docker compose up --build                          # everything, on http://localhost:3000

cd client && bun run dev                            # or one at a time: Vite on :5173
cd server/api/src/Api && dotnet run                 # API on :5002

dotnet test server/api/tests/ArchitectureTests -c Release
dotnet test server/api/tests/GreenhouseTests -c Release
cd client && bunx vitest run
cd e2e && npx playwright test --reporter=line       # stop dev servers first
```

Locally, the ingest defaults to a single small board (`config/boards.dev.json`) to keep runs cheap.

| Path | What |
|---|---|
| [`client`](client) | React SPA |
| [`server/api/src/Api`](server/api/src/Api) | ASP.NET Core API, and the only Anthropic caller |
| [`server/api/src/Core`](server/api/src/Core), [`Infrastructure`](server/api/src/Infrastructure) | Scoring, `Correct()`, claim grounding, repositories |
| [`server/api/src/Greenhouse`](server/api/src/Greenhouse) | Board ingest: publisher and consumer, Greenhouse and Workday sources |
| [`server/api/src/EvalHarness`](server/api/src/EvalHarness) | Golden-set evaluation CLI |
| [`server/mailbot`](server/mailbot) | Gmail sync worker |
| [`server/scraper`](server/scraper) | Legacy jobspy adapter (Python) |
| [`deploy`](deploy) | Compose, Caddy, systemd, monitoring |
| [`docs`](docs) | Design docs for each area |

## Status, roadmap, license

- **Status:** live at [nextrole.cloud](https://nextrole.cloud). Ingest reads Greenhouse and Workday company boards, configured in [`boards.json`](server/api/src/Greenhouse/config/boards.json). Google sign-in, server-side sessions and anonymous-account merge are deployed ([`docs/auth.md`](docs/auth.md)).
- **Roadmap:**
  - More ATS sources behind one adapter contract ([`docs/plans/multi-source-ingest.md`](docs/plans/multi-source-ingest.md), phases 6–7).
  - Paid tiers behind the existing gating ([`docs/plans/feature-gating.md`](docs/plans/feature-gating.md)).
  - Email and passkey sign-in ([`docs/auth.md`](docs/auth.md)).
- **License:** [FSL-1.1-MIT](LICENSE). Each version becomes plain MIT two years after its release.
