# Hosting a public read-only demo

> **You don't need this to use NextRole.** Running your own private instance needs
> only a MongoDB connection string and an Anthropic key (see the main README).
> `DemoMode` is **off by default** — a normal user never touches anything here.
>
> This doc is only for a **maintainer** who wants to expose a *public* instance
> that anyone can explore without touching real data.

## The idea

NextRole is single-tenant with no auth — it's meant to run as *your* private tool.
To put a copy online safely, you run **the same image a second time** with a
different configuration: a read-only instance pointed at a **separate database of
fictional data**. Nothing is forked; the only difference is environment variables.

|              | Private (your real tool) | Public demo                          |
| ------------ | ------------------------ | ------------------------------------ |
| `DemoMode`   | off (default)            | **on** → all tracker writes return 403 |
| Database     | your real DB             | a **separate**, fictional-data-only DB |
| Who uses it  | you                      | anyone (read-only)                   |

With demo mode on, the client shows a "read-only demo" banner (it reads
`GET /api/config`), non-persisting AI analyses still work (score a job, run a mock
interview), and every write to the tracker is blocked.

## The switch = two environment variables

Turning an instance into a demo is exactly two things, and both must be set
together:

1. **`DemoMode=true`** (API) / **`DEMO_MODE=true`** (scraper) — makes it read-only.
2. **A connection string pointed at a separate demo database** — so "read-only"
   is applied to *fictional* data, not your real data.

> ⚠️ Setting `DemoMode=true` **alone** does not protect anything — it just makes
> your *real* data publicly readable. The separate database is the important half.

## Best practice: a least-privilege demo DB user

Don't reuse your admin connection string for the demo. Create a database user whose
privileges are **scoped to only the demo databases**, so the demo credential
*cannot* read production even if it leaks or is misconfigured.

In the Atlas console (`https://cloud.mongodb.com` → your project):

1. **Security → Database Access → Add New Database User**
   - Username: `nextrole-demo`, autogenerate a password (letters/numbers only, or
     URL-encode special characters in the connection string).
   - **Database User Privileges → Specific Privileges**, add two:
     - `readWrite` on `job-tracker-demo`
     - `readWrite` on `jobmatch-demo`
2. **Database → Connect → Drivers** → copy the `mongodb+srv://…` string and swap in
   this user's password.

Prove the isolation with `mongosh "<demo string>"`:

```
use job-tracker-demo   → db.applications.countDocuments()   // works
use job-tracker        → db.applications.countDocuments()   // auth error = good
```

The auth error is the desired outcome — the demo credential physically can't touch
real data.

## Seed the demo databases

Populate the fictional sample data (idempotent — safe to re-run; never run it
against your real DB):

```bash
MongoDB__ConnectionString="<demo string>" \
MongoDB__DatabaseName="job-tracker-demo" \
MongoDB__ProfileDatabase="jobmatch-demo" \
  dotnet run --project server/api/src/Seeder
```

## Environment variables for the public services

**API service**

```
MongoDB__ConnectionString = <demo string>
MongoDB__DatabaseName      = job-tracker-demo
MongoDB__ProfileDatabase   = jobmatch-demo
Anthropic__ApiKey          = <your key>
DemoMode                   = true
CorsOrigins                = https://<your-public-frontend-host>
```

**Scraper service**

```
MONGODB_CONNECTION_STRING = <demo string>
MONGODB_DATABASE_NAME     = job-tracker-demo
DEMO_MODE                 = true
API_BASE_URL              = https://<your-public-api-host>
CORS_ORIGINS              = https://<your-public-frontend-host>
```

**Client service** (Vite bakes `VITE_*` at **build** time — redeploy with the build
cache cleared after changing them)

```
VITE_API_URL     = https://<your-public-api-host>
VITE_SCRAPER_URL = https://<your-public-scraper-host>
```

No **Mailbot** on the demo — it writes to the tracker, which demo mode blocks.

## Verify

- Open the public site → it shows **fictional** data and the **read-only demo**
  banner. `GET https://<public-api>/api/config` returns `{"demoMode": true}`.
- Your **private** instance is unchanged: real connection string, `DemoMode` unset.

## Optional: hosting the PRIVATE instance too (for a cloud mailbot cron)

The mailbot writes to the tracker, so it can't run against the demo — it checks
`GET /api/config` at startup and **aborts (exit 1) if the instance reports
`demoMode: true`**, making the misconfiguration fail visibly. To run the mailbot
as a cloud cron you need a hosted *private* API. NextRole has no auth, so a
publicly reachable private instance must be gated with the shared-secret API key:

**Private API service** (same image as the demo, different env):

```
MongoDB__ConnectionString = <your REAL connection string>
Anthropic__ApiKey         = <your key>
ApiKey                    = <long random secret>   # e.g. `openssl rand -hex 32`
```

With `ApiKey` set, every request must carry a matching `X-Api-Key` header or it
gets 401. `/health` (Render health checks) and `/api/config` (demo-flag probe)
stay open. Do **not** set `ApiKey` on the demo instance — the demo stays public,
protected by `DemoMode` + its isolated fictional DB instead.

**Mailbot cron job**:

```
Tracker__BaseUrl = https://<your-private-api-host>
Tracker__ApiKey  = <the same secret>
Gmail__CredentialsPath / token secret files as before
```

Don't set `Gmail__Query` — the mailbot builds the company-names query itself.

**Optional further: a private *frontend* too** (Basic Auth-gated, real data, reachable from anywhere) — same idea, one more layer. `Dockerfile.private` + `nginx.private.conf` add HTTP Basic Auth (`auth_basic`) in front of the whole site and inject the API's `X-Api-Key` server-side via nginx (`proxy_set_header X-Api-Key`) so the browser never sees that secret. Render mounts Basic Auth's password file (a Secret File) root-readable-only, which the nginx worker can't open directly — a `docker-entrypoint.d/*.sh` script copies it to a worker-readable path at container start (runs as root, before nginx drops privileges).

If this private frontend also needs real (non-demo) job search, the **scraper** needs the same treatment: it now supports an `API_KEY` setting (sent as `X-Api-Key` on every call to `api_base_url`) so a private scraper instance can talk to a key-gated private API. Point the frontend's `VITE_SCRAPER_URL` **directly at the scraper** (like the public demo does), not through nginx — proxying scraper calls through nginx causes Render/Cloudflare to throttle with a `hibernate-rate-limited` 429 whenever the free-tier scraper is cold and gets hit through the extra hop (see Gotchas below).

## Demo Matches pool (seeded, not scraped)

Scoring is demo-allowlisted (`/api/match/discovery-score-batch`, non-persisting
analysis), but scraping real boards from a datacenter IP is unreliable and
would mix real jobs into the fictional demo data. Instead, the pool is
**seeded with fictional postings** written for the demo profile, scored via
the real batched Evaluator path:

1. One-time (or whenever the postings change), with the demo env:
   `MONGODB_DATABASE_NAME=job-tracker-demo python -m app.cli seed-demo-jobs` —
   scores `app/services/demo_seed.py`'s ~24 postings via `POST
   /api/match/discovery-score-batch` (batches of 4, pennies total) and inserts
   them as fully-scored `DiscoveredJob` docs (idempotent; replaces previously
   seeded docs, never touches scraped ones). No Atlas vector index or OpenAI
   key needed anymore — this used to require creating a `jobs_vector_index`
   on the demo DB first (an easy-to-forget manual Atlas UI step); that
   requirement is gone along with `$vectorSearch` itself.
2. Freshness is automatic: on every demo web-service startup (`DEMO_MODE=true`)
   the seeded jobs' `discovered_at` is bumped to now, so they always sit inside
   the Matches page's days-back window and never TTL out. Free-tier cold starts
   happen whenever a visitor arrives — exactly when freshness matters.

## Gotchas

- **Forgetting the scraper.** Both the API *and* the scraper must point at the demo
  DB, or discovery still touches real data.
- **CORS is required, not optional.** The browser calls the API/scraper directly
  (cross-origin), so `CorsOrigins` / `CORS_ORIGINS` must list the exact frontend
  origin (`https://…`, no trailing slash).
- **Empty demo.** If the demo DB has no seeded data, the site renders blank — run
  the seeder above.
- **Scraper double-hop = cold-start 429s.** A frontend that proxies `/api/search`
  through its own nginx to the scraper (instead of calling it directly) triggers
  Render's `x-render-routing: hibernate-rate-limited` when the scraper is asleep —
  curl still works (no CORS enforcement), so this only shows up as a browser bug.
  Call the scraper directly with CORS enabled, matching the public demo's pattern.
