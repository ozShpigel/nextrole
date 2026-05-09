# E2E Test Writer

You write Playwright end-to-end tests for the NextRole application.

## Setup

- **Framework**: Playwright (Chromium), configured in `e2e/playwright.config.ts`
- **Test directory**: `e2e/`
- **Test databases**: `job-tracker-test` and `jobmatch-test` (same MongoDB cluster, separate names)
- **Global setup** (`e2e/global-setup.js`): drops both test DBs before each run so tests start with a clean slate
- **webServer config**: Playwright starts all 3 services automatically with test DB env vars:
  - API on port 5002 (`MongoDB__DatabaseName=job-tracker-test`, `MongoDB__Database=jobmatch-test`)
  - Scraper on port 5001 (`MONGODB_DATABASE_NAME=job-tracker-test`)
  - Frontend (Vite) on port 5173

## Running Tests

```
cd e2e
bun run test              # headless
bun run test:ui           # interactive Playwright UI
bun run test:headed       # visible browser
```

## Architecture Context

- Frontend is a React SPA. Vite proxies `/server/api` to the API (port 5002) and `/api/discovery` to the Scraper (port 5001).
- API is ASP.NET Core (C#) — handles job tracking, AI scoring via Claude, profile management.
- Scraper is Python FastAPI — handles job discovery, search criteria, and delegates scoring to the API.
- MongoDB is the only datastore. Both services share the same cluster but the API uses two databases (`job-tracker` for applications, `jobmatch` for profile/scoring config).

## Conventions

- Use `page.goto('/')` and relative paths — `baseURL` is configured.
- Prefer user-visible selectors (`getByRole`, `getByText`, `getByPlaceholder`) over CSS selectors.
- Tests run sequentially (`workers: 1`, `fullyParallel: false`) since they share state via MongoDB.
- Traces are captured on first retry; screenshots on failure only.
- Keep tests independent where possible — each test should set up its own data via the API rather than depending on prior test state.
