---
name: ai-cost-levers
description: Durable facts for auditing Anthropic spend in server/api — where cost concentrates, which levers are already exhausted, and the Haiku prompt-cache minimum that makes most cache_control markers inert
metadata:
  type: project
---

Established 2026-08-23 (first cost-lens audit of `server/api`).

**Nothing in this project has ever measured post-batching AI cost.** The only two
figures that exist are a pre-Haiku console reading quoted in a `ScoringConfig.cs`
comment and a self-labelled estimate in `docs/scoring-and-search.md` ("not yet
independently re-measured… confirm the actual number from the Anthropic console
after a real run"). Treat any cost claim sourced from a comment as an estimate
from a superseded architecture, and say so when quoting it.

**Why the service can't measure itself:** only calls routed through
`ClaudeClient.CallClaudeAsync` log token usage. Every call site that builds
`MessageParameters` directly (email parse, company summary, why-work-here,
presentation cues, title triage, seniority classify, profile normalize, both
mock-interview calls) logs no usage and gets no prompt caching. That split —
"went through CallClaudeAsync or not" — is the single most useful thing to check
first in any future cost question.

**Haiku's prompt-cache minimum is ~2048 tokens (double Sonnet's ~1024).** This
repo has independently confirmed the asymmetry twice in comments (Sonnet cached
a mock-interview prompt that Haiku would not; the ~600-token Analyst prompt is
below the bar). Consequence: since the 2026-08-11 all-Haiku sweep, a
`cache_control` marker on any system block under ~2K tokens is inert — it neither
saves nor costs anything. Only the Evaluator/EvaluatorBatch prompts are large
enough to actually cache. Do the token arithmetic before crediting or adding a
cache breakpoint.

**Where spend actually concentrates:** output tokens on the ingest scoring path
(Evaluator batch), by roughly an order of magnitude over everything else. Input
hygiene, extra classifier calls, and interactive features are pennies by
comparison — size any proposed fix against that before recommending work. The
one genuinely large untapped lever is Anthropic's Message Batches API (-50%) for
the nightly cron run; it was considered in this audit and judged not yet worth
the async-contract rewrite at current volume.

**How to apply:** in a cost audit, start from `docs/scoring-and-search.md`'s cost
profile section, then verify against `ScoringConfig.cs` and the usage log lines —
never from prose alone. Tail risk on the public demo is a separate question; see
[[demo-public-surface]].

Related: [[api-fragile-areas]]
