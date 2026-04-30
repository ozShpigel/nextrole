# NextRole — Claude Code Guide

## Project

NextRole is a job application platform that automates the job hunting process
end-to-end. It discovers job listings from sites like LinkedIn and Indeed, uses AI
to score and match them against your professional profile, monitors your email for
application updates, and provides a dashboard to track everything — from discovery
through interviews to final status — in one place.

## Stack

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

## Security

- CORS defaults to restrictive (empty) — set `CorsOrigins` env var explicitly
- `/api/match` is rate-limited (10 req/min fixed window) with 50K char max on job descriptions
- Nginx adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` headers