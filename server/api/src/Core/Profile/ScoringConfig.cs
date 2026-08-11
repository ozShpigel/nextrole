namespace ApplicationTracker.Core.Profile;

// Read-only scoring configuration. Bound from the "Scoring" config section via
// the Options pattern (IOptions<ScoringConfig>); the values live in
// appsettings.json and can be overridden per-deploy with environment variables
// (e.g. Scoring__Evaluator__Temperature, Scoring__MinScoreToSave,
// Scoring__VerdictBands__Yes). Admin-only — no runtime UI/endpoint edits.
// The defaults below act as a backstop if a key is absent from config.

public sealed record RoleScoringConfig
{
    // Every role below sets this explicitly to Haiku (2026-08-11 cost sweep —
    // see the Evaluator/InterviewInsights/ResumePack comments). This base
    // default is only a backstop for a role added later without its own
    // Model; kept as Haiku so a new role doesn't silently land back on
    // Sonnet's per-token rate.
    public string Model { get; init; } = "claude-haiku-4-5-20251001";
    public decimal Temperature { get; init; } = 0.5m;
    public int MaxTokens { get; init; } = 4096;
    public bool ThinkingEnabled { get; init; }
    public int ThinkingBudget { get; init; } = 2048;
}

// Score thresholds (inclusive lower bounds) that map an overallScore to a
// verdict. Below `No` => STRONG_NO; a null score => INSUFFICIENT_DATA.
public sealed record VerdictBands
{
    // Golden-set-validated (3x run, 45/45 pass-points, 0% spread, no flaky
    // cases): Yes alone at 72 fixed the accumulated-gaps pattern but
    // destabilized two rock-solid "strong" cases sitting right at that
    // boundary; 68 holds both — the gaps fix comes from StackedGaps
    // (JobMatchService.EnforceStackedGapsCap), not from this threshold.
    public int StrongYes { get; init; } = 85;
    public int Yes { get; init; } = 68;
    public int Maybe { get; init; } = 50;
    public int No { get; init; } = 25;
}

public sealed record ScoringConfig
{
    public RoleScoringConfig Analyst { get; init; } = new()
    {
        Model = "claude-haiku-4-5-20251001",
        Temperature = 0.3m,
        MaxTokens = 2048,
    };

    // 8192 (vs the 4096 base default): the evaluator emits a large verdict JSON
    // plus up to ~1K thinking tokens; 4096 truncated long verdicts mid-JSON
    // (stop_reason=max_tokens) → unparseable → MATCH_FAILED. Headroom is free —
    // only generated tokens are billed.
    //
    // Model = Haiku (was Sonnet): output tokens were ~88% of daily scoring
    // spend ($3.84 of $4.37 on 2026-08-11's 101 scored jobs, per the Anthropic
    // console's token-type breakdown) — the only lever big enough to matter is
    // the per-token rate, not caching or batch size. The golden-set was tuned
    // against Sonnet (3x run, 45/45 pass-points); re-run `python -m app.cli
    // eval-verdict` after this change and watch for regressions before trusting
    // it unattended — Haiku is more likely to miss the nuanced hard-filter/
    // rubric reasoning Sonnet was chosen for.
    public RoleScoringConfig Evaluator { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 8192 };

    // Batched ingest-time scoring: same rubric/model as Evaluator, N jobs (cap
    // 5, see MatchEndpoints) in ONE call — each job gets a full breakdown, so
    // output scales with batch size (~3-3.5K tokens/job observed for a single
    // job). 16000 covers a 5-job batch with real headroom; still one shared
    // system-prompt/profile input cost instead of N, which is the entire point.
    public RoleScoringConfig EvaluatorBatch { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 16000 };

    // Interview Insights: one-shot batch synthesis of recurring themes across
    // all of the user's interview retros. Infrequent ("regenerate" click, not
    // a hot loop) — default MaxTokens covers a handful of themes comfortably.
    // Model = Haiku (was the Sonnet base default): moved along with every
    // other Sonnet call site on 2026-08-11 — see the Evaluator comment above
    // for the cost rationale and the JSON-fragility risk this carries on
    // Hebrew-heavy structured output (confirmed on Evaluator via eval-verdict:
    // a malformed-JSON 500 on a Hebrew field). No golden-set equivalent exists
    // for this endpoint, so a regression here won't be caught automatically.
    public RoleScoringConfig InterviewInsights { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 4096, Temperature = 0.4m };

    // Resume Pack: reorder/re-emphasize the candidate's real experience toward
    // one specific job posting. "Regenerate" click, not a hot loop — lower
    // temperature than free-form prose since this must stay grounded, not
    // creative. 4096 (vs the 3072 v1 default): v2 adds a provenance row per
    // rephrased clause on top of the grouped-skills/side-project objects,
    // pushing typical output past 3072 before truncation.
    // Model = Haiku (was the Sonnet base default) — same 2026-08-11 move and
    // same caveat as InterviewInsights above: no automated regression check
    // exists for this prompt's grounding/anti-fabrication rules under Haiku.
    public RoleScoringConfig ResumePack { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 4096, Temperature = 0.3m };

    public int MinScoreToSave { get; init; } = 70;

    public VerdictBands VerdictBands { get; init; } = new();
}
