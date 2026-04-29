# Job Application Platform — Claude Code Guide

## Project

This is a job application platform that automates the job hunting process           
end-to-end. It discovers job listings from sites like LinkedIn and Indeed, uses AI
to score and match them against your professional profile, monitors your email for  
application updates, and provides a dashboard to track everything — from discovery
through interviews to final status — in one place. 

## Stack

| Layer | Tech |
|---|---|
| Backend | ASP.NET Core (C#) | Python FastAPI |
| Frontend | React + Vite
| Database | MongoDB |

## Project Structure

```
/API      - ASP.NET Core (C#)
/Scraper  - Python FastAPI
/Mailbot  - .NET Console App (C#)
/frontend - React + Vite
```


## Key Conventions

- No test projects in this repo currently
- Two MongoDB databases from one connection — `job-tracker` (application tracking) and `jobmatch` (AI profile/scoring)
- All Claude/Anthropic AI calls live exclusively in the API — the Scraper delegates scoring via HTTP
- Mailbot is a one-shot process (run via cron/scheduler), not a long-running service
- Frontend is a Hebrew RTL SPA
- CI/CD is per-service — each service has its own GitHub Actions workflow with path-based triggers
- AI prompts live in `API/src/Infrastructure/AI/PromptSeeds.cs`; professional profile seed in `API/Data/professional-profile.md`

## Inter-Service Communication

- Scraper → API: delegates AI job scoring via `POST /api/match`, dedup checks via `GET /api/applications/exists`, saves qualifying discovered jobs via `POST /api/applications`
- Scraper → LinkedIn/Indeed: scrapes jobs via JobSpy
- API → Claude API: parses + evaluates jobs
- Mailbot → API: reads active applications and posts status updates via HTTP
- Mailbot → Gmail: reads emails via Google Gmail API
- Mailbot → Claude API: parses emails into status updates
- Frontend (Nginx) → API, Scraper: reverse proxy
