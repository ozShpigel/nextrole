# server/api

ASP.NET Core service that owns: all Claude/Anthropic calls, the application-tracker
CRUD, and the demo-mode write gate. `server/scraper` and `server/mailbot` never call
Anthropic directly — they delegate to this service over HTTP.

Assemblies/namespaces are prefixed `ApplicationTracker` for historical reasons (the
project predates the NextRole rename) — not a vendored dependency.

| Project | What |
|---|---|
| `src/Api` | Minimal-API endpoints, the request pipeline (CORS, rate limiting, the demo-mode allowlist gate), startup wiring |
| `src/Core` | Domain models, matching/scoring logic, repository interfaces — no framework or infra dependencies |
| `src/Infrastructure` | MongoDB repositories, the Claude client, PDF rendering — implements `Core`'s interfaces |
| `src/Seeder` | Offline CLI that populates a demo database with fictional data |

## Where to start

- `src/Api/Program.cs` — the request pipeline: CORS, rate-limit buckets, the
  `ApiKey`/demo-mode gates, startup index creation.
- `src/Infrastructure/AI/ClaudeClient.cs` — every Anthropic API call the whole
  system makes lives here, including per-source (`X-Source`) API key routing.
- `src/Infrastructure/Extensions/MongoExtensions.cs` (via `src/Api/Extensions`) —
  the data layer: collection names, repository DI wiring.

See `docs/scoring-and-search.md`, `docs/design-system.md` (client-facing, but the
theme spec matters for any endpoint shaping UI-consumed data), `docs/tracker.md`,
`docs/interview-prep.md`, `docs/mailbot.md`, and `docs/demo-mode.md` in the repo
root for the feature-level detail — this README is only the map.
