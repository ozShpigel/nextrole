# Scoring Pipeline & Matches

> **Superseded in part (Step 5): ingest no longer scores.** Discovery used to
> score every relevant job at ingest time against the one user's profile. It
> cannot any more: the job pool is shared by every user (`docs/job-pool.md`),
> and a score is an opinion about one candidate. Scoring is **per user and on
> demand** — when a user opens the match tab, `PoolScanService` narrows the
> pool with a cheap Mongo filter over the facts extracted once per job, scores
> only what that user has never had scored, and stores the result in
> `jobScores`. See **Per-user scoring** at the end of this document.
>
> Everything below about the Analyst/Evaluator rubric, the prompts, the
> profile, batching and the verdict bands is unchanged and still current — it
> is only *when* and *for whom* scoring runs that moved.

**Scope (post-RAG-removal): the Evaluator is the primary matching path again.** Discovery scores every relevant job at ingest time via a batched Evaluator call (see **Ingest-time scoring** below); the manual "Score a Job" page (`POST /api/match`) uses the exact same rubric for one-off pasted postings. RAG (Atlas `$vectorSearch`, HyDE, the comparative-ranking "Advisor") was removed — it added retrieval-resolution and batch-composition failure modes that a single-user tool doesn't need to trade cost for. This is a *revival*, not a green-field design: the codebase ran a per-job-scoring architecture before RAG replaced it in 2026, and the schema fields that design left behind (`DiscoveredJob.score/verdict/match_analysis`, `DiscoveryRun.jobs_scored`) are exactly what this flow now populates again.

Each job scoring = 2 Claude API calls: Analyst (Haiku) + Evaluator (Haiku — moved off Sonnet 2026-08-11, see `ScoringConfig.cs`). The **Analyst is a generic job-description parser** (raw posting → `ParsedJob` JSON; `PromptBuilder.BuildAnalysisPrompt` passes the posting in the user message inside `<job_description>`). The **Evaluator** scores fit. Both prompts are written to be **generic and objective** — no candidate/role/stack is baked in; the candidate-specific signal comes only from the injected profile.

## The professional profile (user-editable INPUT)

- **The professional profile is a user-editable INPUT** (not configuration). It is **structured**: experience & skills are LLM-normalized from pasted free text (`POST /api/match/profile/normalize` → `PromptSeeds.NormalizeProfile` → `NormalizedProfile`), while **red flags** (dealbreakers) are the one explicit manual input (never auto-extracted). Stored as `StructuredProfile` on the `profile` doc; `ProfileRenderer.Render` produces the canonical `<professional_profile>` string saved as `content` and injected into prompts via `{{USER_PROFILE}}` — so all consumers (`GetProfileAsync`) keep receiving a plain string. Edited on the Settings page; version-history field is `profile`. Seeded from a **fictional** sample persona (`server/api/Data/sample-profile.json`). **Never hand-edit `content` — edit the structured fields.** Keep agent prompts generic/objective (no candidate/role/stack baked in); candidate-specific signal comes only from the injected profile.
- **Résumé upload**: the same normalize result can also be produced from an uploaded résumé via `POST /api/match/profile/normalize-file` (`IFormFile`, `.DisableAntiforgery()`, same `match` rate limit). **PDF** is handed to Claude as a native `DocumentContent` base64 block (no extraction lib); **TXT** reuses the free-text path; other types → 400. Both share `ClaudeClient.NormalizeProfileCoreAsync` (system prompt + `ExtractJson` + deserialize) with the text path and return the same `NormalizedProfile`. Client: `useNormalizeProfileFile` + the "Upload résumé" control on Settings; `matchApi` skips the JSON `Content-Type` when the body is `FormData`. Demo-allowlisted in `Program.cs` (non-persisting AI). The merge preserves manual red flags, exactly like paste→Normalize.
- **Skills** are `SkillGroup[]` — a flexible list of `{category, items}` groups (real category names, taken from the résumé's own Skills section or invented sensibly by `NormalizeProfile`; no fixed set, no catch-all "Other" bucket). Populated exclusively via Upload/Paste → Normalize, not hand-edited — there's no Skills chip UI on Settings.
- **Red flags UI** (the Dealbreakers tab): edited as **chip inputs** (`components/ChipInput.tsx`) — type-to-add (Enter/comma/blur/+Add), removable chips, case-insensitive dedupe, plus curated `suggestions` quick-add. Flat `string[]` arrays.

## Read-only configuration (Options pattern)

- **Scoring config & prompts are read-only configuration** (admin-only), bound via the .NET Options pattern — not user-editable data. `scoring_config` (models, temperature, max tokens, thinking, `min_score_to_save`, verdict bands) lives in `appsettings.json` under `Scoring`, bound to `ScoringConfig` via `IOptions<ScoringConfig>`. The Analyst/Evaluator system prompts default from `PromptSeeds.cs`, bound via `IOptions<PromptOptions>`. Both override per-deploy with env vars (`Scoring__Evaluator__Temperature`, `Scoring__MinScoreToSave`, `Prompts__Analyzer`, `Prompts__Evaluator`, …). Changing either is a redeploy/restart — there is **no** runtime UI/endpoint to edit them and no 30s hot-reload.

## The match board: retrieve cheap, score on attention

The board is two halves with very different prices, and it used to present only
the expensive one.

- **`GET /api/match/pool-band`** — one profile embedding plus a vector search,
  ~95ms, **no Claude call**. Returns the whole relevant band (default 40, ceiling
  `PoolBandResult.MaxLimit`) in retrieval order, scored or not, with per-user
  score and saved/dismissed state merged in. This is the board's first paint.
- **`POST /api/match/pool-scan`** — the eager scan, which scores the top
  `IPoolJobRepository.MaxCandidatesPerScan` (10 on the Greenhouse source).
- **`POST /api/match/score-jobs`** — scores specific ids, which is what the
  board asks for as the reader scrolls into unscored cards.

**Unscored cards carry no number.** Similarity is the only free signal and it
does not predict fit within the band — measured against 29 real scores at
**+0.65 overall but −0.15 within the top ten**. Showing it as a score would
publish a figure that reshuffles when the real one lands, so the card says "not
scored yet". Tech coverage was tested as an alternative ordering and is worse
than useless (+0.011, and 1/5 recall of the best jobs against similarity's 5/5)
— it is not used.

**Spend follows attention, and four things bound it:**

| Bound | Where | Why |
|---|---|---|
| Dwell of 400ms before a card is requested | `UnscoredCard` | Intersection means "passed the viewport". Measured: one fast flick queued 20 cards and 8 Claude calls for a gesture that read nothing. |
| 2 concurrent batches | `SearchPage` | Otherwise the spend rate is set by scroll speed, not by reading. |
| 10 ids per request | `PoolScanService.MaxIdsPerRequest` | Request shape, not spend: stops one call becoming a scan. |
| 120 jobs per user per UTC day | `PoolScanService.DailyScoreBudget` | The actual ceiling. ~$1.25/day at ~$0.0104 per job, measured. |

The client now names what to spend money on, so **nothing about those ids is
trusted**: already-scored ids are dropped server-side, an id that is not a live
posting is simply not found, overlapping batches cannot both pay for one posting
(a per-user in-flight id set, because this path deliberately does *not* take the
one-scan-per-user gate), and the daily budget is **claimed before the Claude
call** — the pack rule, since a request that fails has still spent the money. A
partial grant scores what it was given rather than dropping the batch. Pinned by
`ScoreByIdsTests`.

**Cost, measured** (Haiku 4.5, 30 jobs, 6 batches, $0.311): **~$0.0104/job**, of
which the Analyst parse was 46% — and that half is user-independent and belongs
to the ingest (`docs/greenhouse.md`), so a posting whose `parsed` is stored costs
roughly half as much to score per user.

## Dimensions, verdicts, mechanics

- **Scoring dimensions**: Technical Fit (35pts), Engineering Execution Fit (30pts), Sustainability & Pace Fit (35pts)
- **A dimension no source can evidence is dropped from the total, not capped.** `EnforceEvidenceCaps` still caps Technical Fit's and Engineering Execution's components when the JD names no technologies or no process signals — the JD is the only possible source for those, so silence there is a fact about the posting. **Sustainability & Pace is different**: its cap was always conditional on there being no pace evidence *elsewhere* (`PaceEvidence.In`), because a JD silent on pace could be paired with Glassdoor review evidence reaching the Evaluator separately.

  Nothing supplies that any more. The Glassdoor scraper was deleted with the criteria path (49 of 875 companies, 5.6%, over its whole life) and Greenhouse never had one — the boards API returns no reviews. So `PaceEvidence.In` is false for every job from every live source, the condition collapsed to "the JD did not mention pace", and a fixed 12+7 = 19 of 35 became a permanent tax instead of a correction. A permanent tax is not neutral: it compresses every score toward the middle and is why a posting matching a candidate's stack exactly could not reach YES.

  So the dimension's `score` becomes **null** — already how this model spells "not assessed", and already rendered as an em dash by `AnalysisCard` — and `ScoreTotal.Renormalised` rescales over the dimensions that do carry a score (here 65, not 100). Components are left exactly as the Evaluator wrote them: nothing renders them, but they are `ClaimGrounding`'s largest scan surface.

  **The maxima are server-side constants** (`ScoreTotal`), never the response's own `maxScore` fields — a total divided by a model-authored denominator is a consequence whose input the model controls. Same rule as `stackedGaps` and `reviewAdjustment`.

  When all three dimensions are scored the denominator is already 100 and the result is the plain sum, bit for bit, so a job with full evidence scores exactly what it did before. Measured across all 58 stored scores (Greenhouse + the dev pool): 26 sit at the pace cap and move, from **-13 to +14, mean -0.3** — 11 raised, 13 lowered. It spreads the distribution rather than inflating it, and **6 verdicts change** (2 YES→STRONG_YES, 1 MAYBE→YES, 1 MAYBE→NO, 2 NO→STRONG_NO). The verdict bands in `scoring_config` were calibrated against the old compressed distribution and are worth re-checking against the new one. Pinned by `ScoreTotalTests`; the arithmetic previously had no test at all, because it lived inside a private method and `PaceEvidenceTests` only ever covered the predicate.
- **Sub-component breakdown**: each dimension's `breakdown.<dim>.components[]` array (modeled by `ScoreComponent` in `MatchResponse.cs`) splits its score into sub-criteria, each with `name`, `score`, `maxScore`, and a one-sentence `reason` — Technical Fit → Core Stack (0-20) + System Design (0-15); Engineering Execution → Role Clarity & Ownership + Engineering Maturity & Stability; Sustainability & Pace → Pace & Workload + Long-term Risk. Dimension score = sum of its components; surfaced by `AnalysisCard` (Matches page card expand, Application Detail page, Manual Score page) alongside a "Signals" summary (recommendation green/red flags). A component may also carry a `reviewAdjustment {base, delta}` (see Employee-review scoring below), rendered in the breakdown as `base N ±delta from employee reviews`.
- **Role-level match rule (System Design cap)**: the Evaluator caps **System Design** at the "transferable concepts" band (4-7 of 15) when the role demands a level the profile never demonstrates — Architect / Staff / Principal titles, or cross-team architecture ownership — and notes the gap in the component `reason` + `redFlags`. Pure seniority prefixes ("Senior") never trigger it; it targets undemonstrated *role scope*, not years.
- **A people-management gap is a score cap, never a hard blocker.** It caps System Design at the transferable-concepts band (4-7) and is stated in the component `reason` and `recommendation.redFlags`. IC mentoring, leading initiatives, and **sitting on an interview panel** do not count.

  It used to be a hard blocker too, and that was removed. Measured: the same five real postings, scored twice against one profile, drew no blocker on the first run and a `people_management` blocker on the second — forcing `STRONG_NO` on all five, with top score dropping 62 → 41. Two of the five state no management requirement anywhere; the rest named only mentoring and "take an active role in conducting engineering interviews", which the prompt already excluded. So the most consequential field in the response was both unchecked and unstable, and removing it loses nothing — the System Design cap was always separate.

- **Hard blockers are an allow-list of two, and the default is DROP** (`HardBlockerScope`, pinned by `HardBlockerScopeTests`). A non-empty `hardBlockers` still forces `STRONG_NO` server-side over any score, which is exactly why only a filter stating something **the candidate declared about themselves** may populate it:

  | Filter | Checked |
  |---|---|
  | `candidate_dealbreaker` | reason must quote one of the profile's own red flags |
  | `work_arrangement` | not structurally — the constraint is free text, and an honest gap beats a weak proxy |

  `scope_discipline` and `sustainability_signals` were removed with `people_management`: disqualifying a posting for saying "wear many hats" or "fast-paced" is taste, not a dealbreaker, and plenty of candidates want that job. Those concerns belong in a dimension's `concerns`, where a posting loses points instead of vanishing. An unrecognised filter — renamed, or emitted by a model running an older prompt — is dropped and logged, because a false blocker does not shade a score, it deletes a job the user never learns existed.
- **Stacked gaps (Core Stack cap)**: every missing *required* named technology/skill (never "nice to have" items). When 4 or more accumulate, `JobMatchService.EnforceStackedGapsCap` caps the Core Stack component at 11/20 server-side regardless of the model's own score — a posting with many individually-minor gaps was being scored too generously on narrative alone; tuning the verdict threshold couldn't separate this pattern from genuinely strong matches without this mechanical check.

  **The list is computed server-side** (`ClaimGrounding.RequiredButAbsent`), from the posting's stated requirements and the candidate's profile. It used to be the model's own field, which made the cap a check whose only input was written by the thing it was checking — and responses that needed capping were exactly the ones that reported the gaps away. See "Grounding the rationale" below.

  **The ceiling scales with coverage** (`CoreStackCap.For`): `min(11, round(20 × matched / required))` once 4+ requirements are absent. It was flat at 11, so four missing requirements and fourteen cost the same, and a candidate with 5 of a posting's 17 kept a score that read as a strong technical match. Coverage rather than the raw gap count, because the count cannot tell 11 missing of 16 from 11 of 40 — see "Choosing the curve".

  **It floors at 0, by design.** A posting whose every stated requirement is absent from the profile has no technical fit to score, and saying so is the point. The other 80 points of the total are untouched by this cap.
- **Verdicts**: STRONG_YES, YES, MAYBE, NO, STRONG_NO, INSUFFICIENT_DATA — re-derived server-side from `overallScore` against `VerdictBands` (currently 85/68/50/25; golden-set-validated, see Regression testing below), never trusted from the model's own `verdict` field alone.
- **`min_score_to_save`** (`Scoring.MinScoreToSave`, API-side) drives `shouldApply` on every scored job — manual and ingest-time alike. `SearchCriteria.min_score_to_save` (scraper-side, per-criteria) went with the criteria documents (docs/scraper-slimming.md) and never was a write trigger — saving to the Tracker is always an explicit user action (`POST /api/discovery/jobs/{id}/save`), never automatic.
- **JSON resilience**: `ClaudeClient.cs` has lenient deserializers, fence/brace extraction, comment stripping, and auto-retry with "return ONLY JSON" nudge
- **Evaluator request**: streamed (keeps the connection alive on long generations), `max_tokens` 8192 for a single job / 16000 for a batch of up to 5 (`Scoring.EvaluatorBatch`), with prompt caching on the static system prompt. All roles share `ClaudeClient.BuildParameters`, which uses `PromptCacheType.FineGrained` with an explicit **1-hour** cache TTL (not the 5-minute default) — single-user traffic is spaced further apart than 5 minutes, so the default window was writing a cache entry on every call and never reading one back (confirmed via the Anthropic console: 0 cache reads with caching nominally on). This matters more now than it used to: back-to-back batch calls in one discovery run share an identical system prompt (rubric + profile), so the cache gets real reuse within a run.
- **Analyst `max_tokens`**: 4096 (`Scoring:Analyst:MaxTokens`). 2048 truncated the `ParsedJob` JSON on long postings → the parse retry (a "return ONLY JSON" nudge) can't fix a length truncation → `/api/match` 500. Bumping it removed that failure (and the wasteful double-call retry).

## Ingest-time scoring (batched Evaluator)

Discovery scores every relevant job as part of ingestion — no separate on-demand search step. The Matches page is a filtered/sorted **browse** over already-scored jobs, not a query-time compute.

- **Ingest** - *removed*. The criteria-driven run (`orchestrator.run_discovery`: scrape -> title triage -> enrichment prefetch -> seniority -> batched scoring at ingest) was deleted in Phase 0 of `docs/scraper-slimming.md`. The daily ingest is now `python -m app.cli run-pool`, which scores **nothing** - it folds listings into the shared pool and extracts each posting's facts once. Scoring is per user and on demand (`POST /api/match/pool-scan`). See `docs/job-pool.md`.
- **Batched scoring, not per-job calls — the primary cost lever**: a naive one-Sonnet-call-per-job design would cost on the order of the old pre-RAG per-job architecture (~$2.5-3/run — see Cost profile below), which is too expensive to run unconditionally on every discovery cycle. Batching shares one system-prompt/profile input cost across up to 5 jobs per call instead of paying it N times — the same mechanism that made the RAG-era Advisor's batched call cheap, applied here **without** reintroducing comparative ranking: each job in a batch is still scored strictly against the fixed rubric, never against its batch-mates. The Evaluator prompt's batch-mode addendum (`PromptBuilder.BuildEvaluationBatchPrompt`) explicitly instructs independence; this was validated against the golden set in batched form before being trusted (see Regression testing below) because batch composition **can** measurably distort individual verdicts if not guarded — this codebase's own Advisor investigation proved that pattern during the RAG era.
- **Concurrency guardrails**: `POST /api/match/discovery-score-batch` has its own rate-limit bucket (`"discovery"`, 20/min) separate from the interactive `"match"` bucket, so a big discovery run never starves the manual Score-a-Job page. The scraper's own `MAX_CONCURRENT_SCORE_BATCHES` (2) caps in-flight batch calls independent of the API's limiter. Both numbers are starting estimates sized to a rough throughput target, not yet measured against a large real run — revisit if a run either 429s or takes uncomfortably long.
- **Matches page** (`GET /api/discovery/jobs` on the scraper, client page `/search`, nav label "Matches"): filters/sorts already-scored `DiscoveredJob` docs — `min_score`, `verdict` (csv), `days_back` (default 14, window over `discovered_at` not posting date), `criteria_id`, `location` (free-text substring, case-insensitive), `is_remote`, `actual_job_level` (csv), `include_dismissed`/`include_saved`, pagination (`limit`/`offset`). Defaults exclude triaged-out jobs, unscored/score-failed jobs (`score: null`), and dismissed jobs; saved jobs stay visible by default ("already in my Tracker" isn't "not interested").
- **Acted-on jobs**: dismiss/save happen against the specific `DiscoveredJob` doc (`POST /api/discovery/jobs/{id}/dismiss` / `/save`) — unlike the old RAG search's URL-set exclusion (which had to dedupe across re-scraped copies of the same posting because ingest never persisted anything until a search ran), ingest-time scoring means every scrape of a posting is its own scored, independently dismissable/saveable document from the start.
- **Retention (M0 512MB)**: TTL index (currently named `ttl_discovered_at_45d` for historical reasons — `app/indexes.py`'s `TTL_INDEX_NAME`) on `discovered_at`, expiry set via `collMod` (falls back to `create_index` on a fresh DB), ensured at scraper startup. Tracker-saved jobs are full copies in the tracker DB, so the purge is safe. Bumped from 45 to 60 days after RAG removal (embeddings were ~12KB/doc of ~18-20KB) — not a full re-measurement, since `match_analysis` + both Claude call snapshots reintroduce their own weight; revisit once real scored-doc sizes are known.
- **`job_level` vs `actual_job_level`**: `job_level` (jobspy) is populated by LinkedIn only. `actual_job_level` is a source-agnostic Haiku classification (`PromptSeeds.SeniorityClassification`, `POST /api/match/seniority-classify`) run once per discovery run over every relevant job's title+description — it **labels** for the Matches page's seniority filter, it does **not** gate the Evaluator call. An imprecise job-only classifier risks silently dropping a real opportunity the same way a wrongly-dropped title-triage call would; the Evaluator's own candidate-aware `hardBlockers` is the more reliable place to catch a genuine scope mismatch.
- **Company profile** (`company_profile` on `DiscoveredJob`, `CompanyProfile` in `MatchRequest`): industry/size/revenue/description/url — free jobspy fields captured at scrape time, no extra HTTP call. Passed to the Evaluator as a `<company_profile>` context block, same "never changes numeric scores, narrative only" rule as `<company_news>`/`<glassdoor_rating>`.
- **Role config vs Matches filters** (two decoupled filter sets): the pool's role list (`config/roles.json` plus `pool_roles`) holds **scrape** parameters - they decide what enters the pool, for everyone. The Matches page's filters (min score, verdict, days-back, location, remote, seniority) are **query-time** filters over this user's scored rows. Per-user saved criteria are gone; the read-side equivalent is `CandidateFilter`, derived from the profile.
- **LinkedIn politeness guardrails** (scraping is unauthenticated - blocks are per-IP 429s/soft blocks, not account bans, and jobspy swallows them silently): (1) **pacing** - random 8-20s sleep between each title x location search (`scraper.PACING_SECONDS`); (2) **search budget** - `max_roles` in `config/roles.json` caps how many roles one run searches; (3) **throttle visibility** - runs carry `searches_total/failed/empty` on the run doc. The per-criteria search budget (`MAX_SEARCHES_PER_RUN`, enforced in `CreateCriteriaRequest`) went with the criteria endpoints. **The client has no Discovery page** - the Matches page is the only view into scored jobs.
- **Regression testing (golden set)**: `dotnet run --project server/api/src/EvalHarness -- verdict [--runs N]` scores 11 hand-labeled real postings (`server/api/src/EvalHarness/fixtures/golden-set.json`, 3-band expected: strong/weak/reject, `uncertain` flag, failure-mode tags) via `POST /api/match` (jobDescription only, matching real manual-page usage), maps the 6-value verdict to the 3-band expected, and reports pass/fail grouped by tag. `--runs N` gives a noise-baseline (pass-rate spread + per-case flakiness). Fails loud — raises rather than report a partial result if any case's call errors, since a run over fewer cases than expected is a different, incomparable denominator. Validated baseline: 45/45 pass-points across 11 cases × 3 runs, 0% spread, zero flaky cases, at `VerdictBands` = 85/68/50/25. This is the primary regression gate for the whole scoring architecture now — every discovered job depends on Evaluator correctness in a way the RAG-era manual-page-only Evaluator never had to guarantee. No `eval-advisor`/`eval-recall` equivalent exists anymore — both tested RAG-specific mechanisms (the comparative-ranking Advisor, `$vectorSearch` retrieval) that no longer exist.
- **Cost profile**: the old pre-RAG per-job architecture (2 Claude calls × every scraped job, no batching) cost ≈ $2.5-3/run — the number batching is designed to beat by roughly the batch-size factor, not yet independently re-measured against a real run under the current batched design. Compare RAG-era ingest, which cost ≈ $0.006/run precisely because it deferred all scoring to on-demand search (≈ $0.10-0.15/search) — that asymmetry (near-free ingest, paid-per-look) is gone by design: this flow pays a real cost on every discovery run regardless of whether the results are ever viewed, in exchange for never missing a job to a retrieval-resolution problem. **Confirm the actual number from the Anthropic console after a real run** before treating either estimate as current.

## Manual scoring (paste & score)

The `/score` page (`ManualScorePage.tsx`, nav: "Score a Job") lets the user paste a job description and score it on demand — no discovery run needed. It reuses the existing live path with **no new backend**: `useScoreJob` POSTs `{jobDescription, title?, company?, location?}` to `POST /api/match` and renders the `MatchResponse` with the shared `AnalysisCard`. Title/company are optional inputs (the analyst extracts them when blank). "Save to Tracker" mirrors the scraper's `save_to_tracker` payload — `POST /api/applications` with `status: "DecidedToApply"`, `source: "manual"`, `matchAnalysis` = the response JSON minus the snapshot fields (snapshots go in their own Application columns) — then links to the new tracker entry. No company-news/Glassdoor enrichment on this path (unlike ingest-time scoring, which prefetches both).

## Employee-review scoring (server-enforced caps)

Deep Glassdoor sub-ratings (see Company Enrichment) feed Engineering Execution & Sustainability sub-scores — but **the prompt's numeric caps are not trusted; the server re-derives them**. Key lesson (recorded in memory): LLMs do **not** reliably obey prompt-stated numeric caps under strong negative evidence, and a "score the base, then adjust" procedure gets gamed by deflating the base. So each eligible component returns a structured `reviewAdjustment {base, delta}` and `JobMatchService.Correct` → `EnforceReviewCaps` **clamps `delta`** by evidence volume (±1 if reviewCount <50/missing, ±2 for 50-199, ±3 for ≥200), zeroes adjustments on non-eligible components (`ReviewEligibleComponents` = Engineering Maturity & Stability / Pace & Workload / Long-term Risk), then **rebuilds dimension sums + overallScore before the verdict-band correction**. Missing review data never penalizes. Prompt→component mapping and direction thresholds live in `PromptSeeds.Evaluator` (EMPLOYEE REVIEW EVIDENCE section). Residual caveat: base contamination can still ~2× the intended impact in the worst case (inherent to single-call scoring); the airtight fix would be deterministic code-computed deltas. This was the first confirmed case of a now-recurring pattern in this codebase — `hardBlockers`/`stackedGaps` (see Dimensions, verdicts, mechanics above) are the same shape: a structured field the model fills honestly, with the actual consequence computed/clamped in code, never trusted from prompt text alone.

## AI title triage (pre-scoring filter)

Job boards pad niche searches with off-target titles (a "DevEx" search scrapes "DevOps Engineer", "Data Engineer", …). Before scoring, the criteria-driven ingest ran **chunked Haiku calls** to drop clearly off-target titles (that path is removed; the endpoint and its contract remain, and the pool ingest does not triage): `match_client.triage_titles(settings, search_intent, jobs)` → `POST /api/match/title-triage` (`ClaudeClient.TriageTitlesAsync`, `PromptSeeds.TitleTriage`, JSON `{results:[{jobId, relevant, reason}]}`). Requests/results are correlated by `jobId` (assigned at scrape time), not list position — a request missing `jobId` gets a `400`, and a response the scraper can't correlate by `jobId` raises rather than falling back to positional matching, so a CD version-skew window between the two independently-deployed services fails loudly instead of silently mismatching scores to jobs. Seniority classification (`classify_seniority` → `POST /api/match/seniority-classify`) shares the same `jobId`-keyed contract. It is **lean-permissive** (keeps borderline/semantic matches like "Infrastructure Engineer (Developer Tooling)") and **fails open** — any failure keeps every job (`triage_titles` returns `None`; callers keep all). **People-management titles are their own role family**: "Team Leader"/"Engineering Manager"/"Head of"/Director/VP are off-target unless the search intent itself includes management titles (scope, not domain — "DevOps Team Leader" is filtered for an IC intent), while IC-plus titles (Tech Lead, Lead Engineer, **Team Lead** — the -er suffix is the line, and Haiku needed a worked-example pair in the prompt to hold it, abstract prose wasn't enough) always stay. **Language parity**: titles in any language (Hebrew common) are translated and judged by the same rules — an unfamiliar language is never "uncertain → keep" (a Hebrew mechanical-design title was slipping through while its English twin was filtered). Scraped titles are **untrusted data** (XML-wrapped `<scraped_titles>`, intent in `<search_intent>`). Dropped jobs persist as `DiscoveredJob(triaged_out=True, triage_reason=…)` — never scored — and the run carries `jobs_triaged_out`. Endpoint is scraper-internal (shares the `discovery` rate-limit bucket, max 200 titles) and demo-allowlisted in `Program.cs`.

**Chunking, and why the output budget is not a single number.** Both `jobId`-keyed calls send every item in one request, so the response size scales with the batch — and the endpoints accept up to 200 items. `ClaudeClient` therefore splits them into chunks of `ClassifyChunkSize` (25) at `ClassifyChunkMaxTokens` (4000), `ClassifyChunkParallelism` (4) in flight, and merges the results; the chunk count keeps a full 200-item run inside the scraper's 120s client timeout. This is not premature generality. Moving the contract from `{"index":12}` to a 36-char UUID tripled the cost of a result row (~50 output tokens, measured on Haiku 4.5: 30 titles → 1512 tokens, 48 titles → truncated) while `MaxTokens` stayed at 2000, so from 2026-08-31 every run over ~40 titles truncated mid-JSON, triage failed open, and **twice as many jobs reached the paid Evaluator for twelve days** while each run still reported `completed`.

**Truncation is not a parse failure.** Past `MaxTokens` the JSON is cut off mid-array and `ExtractJson` throws the same exception a genuinely malformed answer would — which is precisely why the above went unnoticed. `ThrowIfTruncated` checks `stop_reason == "max_tokens"` first and names the cause; a failing chunk is logged and dropped, leaving its items without a verdict (so they are kept) rather than discarding the chunks that succeeded.

The same check guards every role that goes through `CallClaudeAsync`: a `max_tokens` stop throws immediately instead of taking the one repair-retry. **Retrying a truncation cannot succeed** — it asks for the same output under the same budget and dies at the same place, having first paid to re-send the truncated attempt as an assistant turn (measured on a real 4-job `parse-batch`: attempt 1 `input=6616/output=4096 stop=max_tokens`, attempt 2 `input=10734/output=4096 stop=max_tokens`, then a "failed to return valid JSON after retry" naming the wrong cause). This is what `jobs_score_failed` was: `AnalystBatch.MaxTokens` sat at 4096 on a "~350-390 tokens/job" estimate that was never true of the shipped schema. Measured over 813 real postings, a ParsedJob is ~746 output tokens at the median, so a median 4-job batch used ~2982 of the 4096 — under the ceiling, but with only ~27% headroom and a long right tail (p99 4863 chars, max 8105). Extraction is unbounded by design: no array has a cap and `namedTechnologies` is explicitly told to restate what `requiredSkills`/`technicalRequirements` already list, so one dense JD can carry a 24-entry skills array. Simulating random 4-job batches against that distribution puts the overflow rate at **~3.6%** — matching the observed 1-2 dead batches per run — and an overflowing batch loses all four jobs, which is why `jobs_score_failed` always came in exact multiples of `SCORE_BATCH_SIZE`. Two things then narrowed the margin at once, four days apart: `namedTechnologies`/`processSignals` reached production on 2026-08-30 (+12% array items per job), and triage broke on 08-31, doubling the batches per run and admitting the verbose off-target postings triage used to drop. Now 16000, matching `EvaluatorBatch`, whose own measured range (3567-4568) was never at risk.

Sampling caution for anyone re-measuring this: the five batches replayed to confirm the fix emitted 2748-5237 output tokens, but they were selected *because* they had failed. That is the overflow tail, not the population — read the 3.6% from the per-job distribution above, not from those five.

**The run records the outcome.** `jobs_triaged_out=0` alone cannot distinguish "nothing was off-target" from "triage never answered", so `DiscoveryRun` carries `triage_status` (`ok` | `partial` | `failed` | `skipped`) and `triage_unresolved`, plus the same pair for seniority. Fail-open is still the right default for relevance — it is the wrong default for cost, and these fields are what make the difference visible.

## Company Enrichment

The scraper enriches jobs with external data **at ingest time, prefetched once per unique company across the whole relevant set of a discovery run** (moved back to ingest timing when RAG's on-demand top-N-only enrichment was removed — enrichment is now cheap relative to the Evaluator call it feeds, and every scored job benefits from it on its first and only score, not just a query-time top slice). The payloads feed the batched scoring call; the manual `/api/match` path takes them as optional request fields (but nothing currently populates them there — see Manual scoring above):

- **Company News** — Google News RSS headlines (`news_client.py`). Passed to the evaluator prompt in `<company_news>` XML tags. AI reports green/red signals in `companyNewsAnalysis` (does not change numeric score).
- **Glassdoor Rating** — scraped from DuckDuckGo search snippets (`glassdoor_client.py`). Passed in `<glassdoor_rating>` XML tags (a `{rating, reviewCount, url}` projection, emitted only when an overall rating exists). AI factors it into the cultural fit narrative.
- **Employee reviews (deep Glassdoor)** — the same `glassdoor_client.py` runs a **3-query DDG cascade** and parses structured review aggregates out of the snippets: per-category **sub-ratings** (`workLifeBalance` / `cultureAndValues` / `careerOpportunities` / `seniorManagement` / `compensationAndBenefits`), **recommend-to-friend %**, review count, and up to 2 verbatim snippets. Merged into the same `glassdoorData` payload (no new field — flows through every hop untouched). Q1 (`{company} glassdoor work life balance reviews`) parses the deep fields and **strips sub-rating spans before the overall-rating regex** so a sub-rating isn't misread as the overall; Q2/Q3 backfill the overall rating only if still missing. Politeness: a module-level `asyncio.Semaphore(4)` + jitter around the HTTP call — this is the same guardrail that bounded top-N-only enrichment during the RAG era, now exercised at whole-run scale (a run's unique-company count, not a 15-item slice); watch DDG failure/timeout rates until this is exercised on a real large run. Small companies return nothing → graceful degradation (the whole payload may be `None`). Emitted to the evaluator in a separate `<employee_reviews>` block; **unlike news/overall-rating, this evidence moves the numeric sub-scores** (see Employee-review scoring above). AI green/red signals in `employeeReviewsAnalysis`. Pytest: `server/scraper/tests/test_glassdoor_client.py` (regex-parsing is the regression-prone part; DDG bolds query terms, so `_clean_text` collapses whitespace).
- **Company Summary** — on-demand AI-generated summary (3-4 lines) of what the company does, including approximate employee count. Always generated in English; a Hebrew translation can be requested separately (see "On-demand AI" below). Generated via `POST /api/applications/{id}/company-summary` using Claude's knowledge base (no external data). Persisted on the `Application` document.

Both news and Glassdoor are prefetched in parallel per discovery run, cached per unique company within that run. If either fetch fails, scoring proceeds without it.

## On-demand AI (application detail) — and its auto-generated counterpart

Company Summary, Why Work Here, and full-narrative enrichment can each still be triggered manually from the tracker detail page, but all three also fire **automatically** the first time an application's status crosses into an interviewing stage (`PhoneScreen`/`TechnicalInterview`/`FinalRound`/`OfferReceived`/`Accepted`) — see `ApplicationEndpoints.EnrichOnInterviewingAsync`, fired fire-and-forget from the `PUT /applications/{id}/status` handler (the single choke point both manual status changes and mailbot's auto-detected transitions go through, so both get this for free; own `IServiceScopeFactory` DI scope since the request scope is gone by the time it runs). Each of the three is independently best-effort (its own try/catch — one failing doesn't skip the others) and each is skipped if the field is already populated, so a value the user already generated manually is never silently overwritten:

- **Company Summary** — `POST /api/applications/{id}/company-summary` (`ClaudeClient.SummarizeCompanyAsync`, Claude's own knowledge base, no external data). 3-4 lines on what the company does + approximate employee count, always generated in English. Stored on `CompanySummary`.
- **"Why work here?" answer** — a personalized single paragraph, always generated in English, answering the interview question. Combines the user's profile + interview-prep self-presentation (trusted, in the system prompt) with the job/company context — description, company summary, news, Glassdoor (untrusted, XML-wrapped in the user message). Generated via `POST /api/applications/{id}/why-work-here` (`ClaudeClient.GenerateWhyWorkHereAsync`, one-shot Haiku), stored on `WhyWorkHere`.
- **Hebrew translation, on demand** — `PromptSeeds.TranslateFreeText` / `ClaudeClient.TranslateTextAsync` (plain-text counterpart to `TranslateMatchAnalysisAsync`) translates the current `CompanySummary`/`WhyWorkHere` into `CompanySummaryHebrew`/`WhyWorkHereHebrew` via `POST /api/applications/{id}/company-summary/translate` and `.../why-work-here/translate` — same cache-once/`translate` rate-limit-bucket shape as `translate-analysis`, and cleared whenever the English source is regenerated. The client's single "Translate to Hebrew" toggle fires all three translate calls (match analysis + these two) together. Replaces the older `Prompts__HebrewOutput__WhyWorkHere`/`CompanySummary` deployment flags, which generated Hebrew directly at generation time with no English version available at all.
- **Full-narrative enrichment** — `NarrativeEnrichment` (`ClaudeClient.EnrichNarrativeAsync`, `claude-sonnet-5`) upgrades `honestAssessment`/`recommendation` (`keyReasons`, `questionsToAsk`, `redFlags`, `greenFlags`) from terse to full detail. Used to fire on every "Add" click instead — wasted spend on the majority of added jobs that never reach an interview, and the content wasn't even displayed that early (the detail page's `showFullAnalysis` gate hides `AnalysisCard`/Why-Work-Here/Company-Info until Interviewing — see `docs/tracker.md`). Merges into the stored `MatchAnalysis` via `JsonNode` surgery (only the fields `NarrativeEnrichment` owns) rather than a typed deserialize/re-serialize round-trip, so any field not modeled on `MatchResponse` survives untouched.

## Grounding the rationale

The Evaluator was claiming technologies the candidate did not have, and the
shape of the claim came from the posting: it read the requirement list back as
a description of the candidate. Against a Lead Data Engineer whose profile
contains no `Kubernetes`, no `AWS` and not the word `cloud`:

| Posting | Required tech he had | The rationale said | Score |
|---|---|---|---|
| Zscaler, Sr. DevOps Engineer | 5 of 17 | "AWS/EKS/Kubernetes/Terraform - perfect stack match" | 88 |
| Paragon, SRE | 1 of 8 | "Python/Kubernetes/Prometheus - strong match" | 73 |
| Aidoc, Senior DevOps | 1 of 8 | "Terraform/Kubernetes/AWS - strong match" | 71 |

Two separate faults, both in `ClaimGrounding` now:

**1. The gap count was the model's own.** `stackedGaps` was the only input to
the Core Stack cap, and the model wrote it in the same response as the claim.
Zscaler: 12 required technologies absent from the profile, **1** self-reported
gap, Core Stack 20/20, and the cap never fired. `RequiredButAbsent` computes
the list from `must_have_tech` (extracted once at ingest, user-independent —
`docs/job-pool.md`) against the profile; the Analyst's `NamedTechnologies`
minus its nice-to-haves is the fallback on the manual page. Aliases collapse
(`EKS` is not a second gap beside `Kubernetes`), and a nice-to-have is never a
gap. The model still fills the field and a divergence of 2+ is logged — the
cheapest available signal that the Evaluator is talking itself out of gaps.

**2. There was a rule for "he lacks X" and none for "he has X."** The prompt
constrained `stackedGaps` and said nothing about the free text, while its own
QUICK HIGHLIGHTS example taught the exact failing shape
(`Right: "Core stack match - Kubernetes"`). `ClaimGrounding.Find` scans
`quickHighlights`, every component `reason` and `honestAssessment` for any
posting technology the profile does not evidence, and reports them on
`MatchResponse.UnsupportedClaims`.

**It annotates, it does not block.** A withheld score leaves a blank card; a
score with the unsupported claim named is more useful. (A résumé pack goes to
an employer, so `ResumePackValidator` blocks — different audience, different
answer.)

Mechanics worth knowing before changing it:

- **The comparison is `ProfileTrace`**, shared with `ResumePackValidator`'s
  `SkillItemDropped` so both sides ask the question the same way: token-level,
  contiguous-run, so "Go" does not trace to "Django".
- **Grounding reads the whole profile**, not just Skills — the Evaluator is
  handed the rendered profile, so a technology named in an experience highlight
  ("Spark jobs in Scala") is genuinely supported.
- **Polarity is decided per clause**, because one sentence routinely asserts one
  technology and denies another ("Python strong; Kubernetes new but adjacent").
  Clause boundaries are `;`, `·` and a full stop *followed by whitespace* —
  splitting on every `.` cut `Node.js` in half and turned "Missing TypeScript,
  Node.js, React, Next.js, and AWS" into a claim about AWS. That one bug was
  most of the checker's false positives; `/` is deliberately not a boundary,
  because `Python/Kubernetes/AWS` is one claim per name sharing one verdict.
- **It is a verbatim check, so it is literal.** Concrete product names
  (Kubernetes, AWS, Prometheus, Redis, Grafana) are reliable. Capability
  phrases that the extractor sometimes emits as "technologies" — "distributed
  systems", "microservices", "CI/CD" — get flagged when the profile evidences
  the concept under other words (GitHub Actions is CI/CD). Measured at 185
  claims over 111 real scored jobs, those phrases are ~9% of the total.

Measured by replaying stored Evaluator responses through the real correction
path. Grounding alone, on the 111 scored pool jobs of the profile that surfaced
the bug: 22 scores changed, mean -5.6, largest drop -9 (the flat ceiling bounded
it), and **60 of 111 jobs carried at least one unsupported claim** — Kubernetes
55, AWS 37.

With the coverage-scaled ceiling (below), across all three profiles:

| Profile | jobs | scores changed | verdicts moved | mean | worst |
|---|---|---|---|---|---|
| Lead Data Engineer | 111 | 61 | 20 | -7.0 | -16 |
| Backend / platform | 142 | 50 | 17 | -6.4 | -17 |
| Full stack | 46 | 24 | 5 | -6.2 | -12 |

`STRONG_YES` counts went 2 -> 1, 5 -> 1 and 1 -> 0. Every one of those drops was
a posting where the rationale claimed a stack the profile did not evidence: the
two largest, both at 10 of 11 stated requirements absent, had Core Stack 18 and
19 out of 20 and read "Strong Python, asyncio, pytest, LLM integration match".

### Choosing the curve

Four candidates were replayed through the real correction path over **299 real
scored jobs across three profiles**, with the stored Evaluator responses as
input. The measurement that mattered was not the one on the profile that
prompted the change — a curve measured only on a candidate whose whole pool is
off-target looks good whatever it does. Two on-target profiles were included as
controls: a backend/platform engineer against backend postings, and a full-stack
engineer against full-stack postings.

| | Rule | Verdicts moved: data eng. | backend | full-stack |
|---|---|---|---|---|
| A | `gaps≥4 → 11` (was shipped) | — | — | — |
| B | `11 − 2·(gaps−4)`, floor 2 | 8 | **12** | 4 |
| **C** | `gaps≥4 → min(11, 20·matched/req)` | 7 | 10 | **2** |
| D | `4-5:11 6-8:8 9-11:5 12+:3` | 4 | 8 | 2 |
| E | `coverage<0.6 → 20·coverage`, no gate | 10 | **18** | 3 |

**E is out on the control.** Without the gap gate, coverage fires on postings
that name only three or four technologies, where it is noise: an on-target match
with 2 gaps of 4 and Core Stack 17/20 lost seven points, and the one genuinely
well-matched posting in the other candidate's pool fell from 93 to 85.

**B is the wrong shape.** Reading only the count, it was simultaneously harsher
on the controls and *milder* on the worst mismatches than C — more aggressive on
honest matches and less on fabricated ones, which is backwards.

**C keeps the `gaps ≥ 4` gate and `min(11, …)`**, so it is a strict tightening:
no job scores higher than it did under the flat rule, and nothing below the
threshold is touched at all. `ClaimGroundingTests` pins both ends — the
arithmetic across the boundary, and four real postings that must not move.

#### Known limitations, measured and deliberately left

**Nothing propagates a stack mismatch into the other three dimensions.** Core
Stack is 20 of 100. Zscaler's Sr. DevOps Engineer — 5 of 16 stated requirements
present, Core Stack capped from 20 to 6 — still lands at **74**, a mid-board
MAYBE, because System Design, Engineering Execution and Sustainability are
scored against process and pace signals that have nothing to do with whether the
candidate can do the work. The lever for that is dimension propagation, not this
curve. Recorded rather than changed: this was the third scoring change in a day
and the next one wants a week of real scores behind it.

**Coverage penalises postings that enumerate many niche tools.** A posting
listing eleven named frameworks gives low coverage even to a strong general
match: a senior Python engineer against `Python, asyncio, pytest, Playwright,
LangGraph, Claude Agent SDK, OpenAI Agents SDK, DSPy, MLflow, LangSmith,
Braintrust` evidences one of eleven, and the ceiling drops to 2. That case scored
92 on a rationale claiming "Strong Python, asyncio, pytest" — so capping it is
right here — but the mechanism would treat a genuinely strong candidate the same
way. Bounded by the 4-gap gate and by the cap only touching one component of
four.

**The claim check is verbatim, so capability phrases over-flag.** "CI/CD" is
flagged against a profile that says GitHub Actions, "distributed systems"
against one that describes 2.3 TB/day pipelines. ~9% of flags. Tolerable while
this annotates rather than blocks; it would not be tolerable if it ever gated.

## Per-user scoring (Step 5)

The pool is shared; scores are not. `discovered_jobs` holds what a posting
says, `jobScores` holds what it is worth to one user — keyed by
`(userId, jobId)`, user-scoped like every other per-user collection
(`docs/multi-user.md`).

**On match-tab open** (`POST /api/match/pool-scan`):

1. **Cheap Mongo filter** (`CandidateFilter.FromProfile` → `PoolJobRepository`)
   over the facts extracted once per job: location, seniority band, tech
   overlap. Every clause is "matches **or** is unstated" — the extraction is
   best-effort, and missing facts must never hide a job. Seniority accepts one
   band either side of the candidate's own; location matches on the country,
   not the city, and never excludes a remote posting. Tech is compared with a
   case-insensitive collation rather than by storing a second lowercased copy.
2. **Score only what is new.** "New" is decided by the *absence of a jobScores
   row*, not by a last-visited timestamp. Same answer for the common case, and
   a better one otherwise: it also picks up a job that only started matching
   after a profile edit, and two tabs scanning at once cannot double-charge.
3. **Persist**, including failures. A job the model returned nothing for still
   gets a row carrying the reason — without it, every visit would re-send it
   and be billed again.

Bounds: `IPoolJobRepository.MaxCandidatesPerScan`. A first-ever scan, or a
profile edit that widens the filter, must not become an unbounded scoring bill
in one request; the remainder is picked up on the next visit (`capped: true`
says so). A user with no profile yet scores nothing at all and spends nothing.

The cap lives **on the source**, not on the scan, because the two sources are
capped for different reasons and the numbers cannot be reconciled. The pool's
Mongo filter returns everything that survived it, in no order of fit, so 50 is
a spend ceiling. Greenhouse returns a vector-ranked list, where the top few
*are* the answer and the tail is noise the scan would pay Claude to reject, so
it is 5 — and 5 rather than 6 because a batch is five jobs and one Analyst plus
one Evaluator call, so a sixth candidate buys a whole second batch for one job.
Keeping the number on the repository means flipping `Greenhouse:UseAsJobSource`
moves the cap with the source instead of leaving one that is right for only one
of them. `Greenhouse:MaxCandidatesPerScan` can tune the ranked source's depth
on the box; it cannot reach the pool's.

**Pack quota: 3 per user per UTC day.** Claimed atomically in
`UserQuotaRepository` *before* the Claude call — the `pack` rate-limit bucket
caps bursts, this caps spend. A generation that fails or is rejected by the
validator still costs the allowance: the call was made and billed. Over the
limit returns `429` with the limit in the body.

### The match tab

`SearchPage` runs the scan **once per mount** (`usePoolScan`), not on every
filter change: a scan costs Claude calls, and the filter controls are a view
over what has already been scored. The jobs query is invalidated only when
something was actually scored, so a no-op scan does not make the board flicker.
Skipped entirely on the read-only demo, where the scan would 403 on every open
over a board that is fully populated from seeded data.

`capped` drives an explicit **Score more** control, not an automatic loop.
Auto-draining would defeat the cap, which exists to bound what one visit can
spend. The server only sets the flag when a further page genuinely exists (it
fetches one row past the cap to find out), so the control is never a no-op —
and because already-scored jobs are excluded *in the query*, each press makes
real progress instead of re-reading the same first page.

**The board distinguishes four reasons it can be empty**, because "relax the
filters" is the wrong answer to three of them:

| State | What it says |
|---|---|
| `profileMissing` | Upload your CV in Settings — nothing is scored until we know what you do |
| scan in flight | Scoring the job pool against your profile… |
| scan failed | Couldn't score the job pool: *reason* |
| scanned, nothing scored for this user | No matches yet — nothing in the pool of *n* open roles lines up with your profile |
| scored, but filtered out | No matches — widen the date range or relax the filters |

**The Matches read path** (`GET /api/discovery/jobs`, the scraper) joins this
user's `jobScores` rows onto the shared pool documents and presents them under
the field names the client has always read, so the score/verdict filters and
the sort operate on the user's own numbers. The join is done in the service
rather than with `$lookup` because the sort key lives in the joined collection;
a user has at most a few hundred scored jobs, so loading their rows and merging
is simpler and cheaper than an aggregation that would have to sort afterwards
anyway.
