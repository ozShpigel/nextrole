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

## Gotchas

- **Forgetting the scraper.** Both the API *and* the scraper must point at the demo
  DB, or discovery still touches real data.
- **CORS is required, not optional.** The browser calls the API/scraper directly
  (cross-origin), so `CorsOrigins` / `CORS_ORIGINS` must list the exact frontend
  origin (`https://…`, no trailing slash).
- **Empty demo.** If the demo DB has no seeded data, the site renders blank — run
  the seeder above.
