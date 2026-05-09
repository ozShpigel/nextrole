# NextRole — Claude Code Guide

## Project Overview

NextRole is a job application platform that automates the job hunting process
end-to-end. It discovers job listings from sites like LinkedIn and Indeed, uses AI
to score and match them against your professional profile, monitors your email for
application updates, and provides a dashboard to track everything — from discovery
through interviews to final status — in one place. See `docs/project-scope.md` and `docs/implementation-plan.md` for full detail.

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | ASP.NET Core (C#) · Python FastAPI |
| Frontend | React + Vite + shadcn/ui + Tailwind CSS v4 |
| Database | MongoDB |

## Project Structure

```
/API      - ASP.NET Core (C#)
/Scraper  - Python FastAPI
/Mailbot  - .NET Console App (C#)
/frontend - React + Vite
```

## Key Conventions

- Use context7 MCP server to fetch up-to-date documentation for libraries
- All Claude/Anthropic AI calls live exclusively in the API — the Scraper delegates scoring via HTTP
- Mailbot is a one-shot process (run via cron/scheduler), not a long-running service
- Frontend is an English LTR SPA using shadcn/ui components with the default neutral theme
- AI prompts use system/user separation: trusted instructions in the API system prompt field, untrusted external data (job descriptions, emails) in the user message wrapped in XML tags
- `scoring_config` keys are validated against an allowlist before persisting to MongoDB

## Company Enrichment

The Scraper enriches each discovered job with external data before scoring:

- **Company News** — Google News RSS headlines (`news_client.py`). Passed to the evaluator prompt in `<company_news>` XML tags. AI reports green/red signals in `companyNewsAnalysis` (does not change numeric score).
- **Glassdoor Rating** — scraped from DuckDuckGo search snippets (`glassdoor_client.py`). Passed in `<glassdoor_rating>` XML tags. AI factors it into the cultural fit narrative.
- **Company Summary** — on-demand AI-generated Hebrew summary (3-4 lines) of what the company does, including approximate employee count. Generated via `POST /api/applications/{id}/company-summary` using Claude's knowledge base (no external data). Persisted on the `Application` document.

Both news and Glassdoor are prefetched in parallel after scraping, cached per company within a discovery run, and stored on the `DiscoveredJob` document. If either fetch fails, scoring proceeds normally without it.

## Testing

E2E tests use Playwright. Use the `e2e-test-writer` agent to write tests — it has the full setup details, database config, and conventions.

## Security

- CORS defaults to restrictive (empty) — set `CorsOrigins` env var explicitly
- `/api/match` is rate-limited (10 req/min fixed window) with 50K char max on job descriptions
- Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` headers