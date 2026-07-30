# Single-tenant design, Demo mode & ApiKey gate

**Single-tenant by design** (one user, no auth — intentional). Public exposure runs **two instances of the same code**, each pointed at its own Mongo: a private real instance and a public **demo** instance on a separate seeded DB.

- The demo sets `DemoMode=true` (API) / `DEMO_MODE=true` (scraper) → tracker writes return 403 while AI analyses stay enabled (**allowlist middleware** in `Program.cs` / `main.py` — new mutating endpoints must be allowlisted to work in demo); the client reads `GET /api/config` for the read-only banner. This cuts the other way too: `POST /api/match/profile/normalize-file` was allowlisted while it only returned ephemeral parsed data, then **removed** from the allowlist once it started also persisting the uploaded résumé itself (`Core/Models/ResumeFile.cs`, shown on the Profile page's "Resume" section) — an endpoint's allowlist status has to track what it actually does now, not what it did when first added.
- **`DemoMode` only gates writes + the banner — *which data shows* is decided by the connection string + DB-name env vars, not the flag.**
- Seed demo data (applications, profile, discovery, interview-prep; idempotent) with `dotnet run --project server/api/src/Seeder`.
- Deployment/ops for the public demo (separate DB, least-privilege Atlas user, exact env vars) live in `docs/hosting-a-public-demo.md`; `.env.example` files are kept demo-free.
- Optional integrations degrade gracefully (no Gmail → mailbot skips; app runs on just Mongo + AI key). See README.

## ApiKey gate (hosting the private instance publicly)

Needed for a cloud mailbot cron: set `ApiKey` on the API → every request must send a matching `X-Api-Key` header or 401 (constant-time compare; `/health` + `/api/config` + OPTIONS stay open; middleware in `Program.cs`); the mailbot sends it via `Tracker__ApiKey`. **Never set `ApiKey` on the demo.**

## Mailbot demo guard

The mailbot **fails fast** (exit 1) when its tracker reports `demoMode: true` at `GET /api/config` — a demo can't accept its writes, so a run against it is always a misconfiguration (this bit us: the Render cron silently synced the 6 seeded demo apps for months).
