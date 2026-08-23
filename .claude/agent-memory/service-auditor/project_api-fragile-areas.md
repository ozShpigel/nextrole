---
name: api-fragile-areas
description: Durable fragile areas and known drift patterns in server/api (ASP.NET Core) — where accumulated risk concentrates between audits
metadata:
  type: project
---

Baseline established 2026-08-23 (first standing audit of `server/api`).

**Where risk concentrates:**

- **The `DemoMode` allowlist block in `Program.cs`.** It grows one bespoke exception
  per product decision — exact-path sets, compiled regexes, request-body sniffing
  (`"Withdrawn"` substring), and an `X-Source` header check. Each exception is only as
  strong as its heuristic, and they are added one at a time by different features. This
  is the single highest-churn, highest-consequence block in the service.
- **`Infrastructure/AI/ClaudeClient.cs`.** Already had one real production bug (shared
  `HttpClient` collapsed all per-source Anthropic keys onto one). The per-source key
  routing depends on a DI singleton reading `IHttpContextAccessor` — subtle, and
  regressions are silent (billing splits vanish, nothing errors).
- **The data layer.** The API has no index-management story of consequence, while
  `server/scraper/app/indexes.py` actively manages a TTL for the same Atlas cluster.
  Both services share one `MONGODB_CONNECTION_STRING`; the scraper's comments state
  it is an M0 (512 MB) tier. Capacity is a cross-service concern nobody owns.

**Drift patterns observed (recheck each audit, do not assume fixed):**

- **Prompt-injection invariant.** `PromptBuilder` upholds system/user separation
  rigorously, but direct `MessageParameters` call sites in `ClaudeClient` bypass it.
  Grep for `string.Format(PromptSeeds` and for system prompts built with a
  `StringBuilder` — those are where untrusted data leaks into the system role.
- **Model-choice docs.** A 2026-08-11 cost sweep moved every call site from Sonnet to
  Haiku in code. `docs/` and `docs/images/*.svg` were not updated. Assume any prose or
  diagram claiming a model is stale until verified against `ScoringConfig.cs` /
  `ClaudeClient.cs`.
- **Config shadowing.** `appsettings.json` "Scoring" silently overrides the C# defaults
  in `ScoringConfig.cs` — and all the reasoning comments live in the C# file, not the
  JSON. Verify which value actually wins before quoting one.

**How to apply:** prioritise these areas on the next run rather than re-reading the
service alphabetically. Nothing here has been declared won't-fix by the user yet.

Related: [[demo-public-surface]]
