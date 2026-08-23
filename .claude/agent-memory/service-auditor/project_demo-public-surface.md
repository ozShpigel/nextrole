---
name: demo-public-surface
description: How to determine what of server/api is actually internet-facing on the public demo — a two-file inference (nginx prefix rules + Program.cs allowlist) worth redoing every audit
metadata:
  type: project
---

Determining the demo instance's real public attack surface requires joining **three**
files; no single file states it, and reading only `Program.cs` gives the wrong answer.

1. `deploy/Caddyfile` — `nextrole.cloud` → `demo-client:80`
2. `deploy/nginx/demo.conf.template` — proxies by **path prefix**, notably
   `location /api/match` (prefix, not exact). Any route added under `/api/match/*`
   becomes internet-facing on the demo automatically, with no config change.
3. `server/api/src/Api/Program.cs` — the `DemoMode` allowlist decides which of those
   reachable routes may also *write*.
4. `deploy/.env.example` — `.env.demo-api` carries a real `Anthropic__ApiKey` and
   deliberately no `ApiKey` gate (per AGENTS.md, "never set ApiKey on the demo").

**Why:** the demo is a portfolio artifact hosted with a live billed Anthropic key and
no auth. Cost/abuse exposure is decided by the intersection of "nginx proxies it" ×
"demo allowlist permits it" × "endpoint has a rate-limit bucket" — three independent
lists that nobody edits together.

**How to apply:** when auditing `server/api`, never judge an endpoint's exposure from
`Program.cs` alone. Cross-check the nginx prefix rules, then check whether the route
carries `.RequireRateLimiting(...)`. Endpoints justified in code comments as
"scraper-internal, so no rate limiting" are the ones to look at first — that
justification is false for anything under a proxied prefix.

Related: [[api-fragile-areas]]
