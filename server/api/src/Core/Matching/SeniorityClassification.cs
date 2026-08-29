namespace ApplicationTracker.Core.Matching;

// One cheap Haiku call per discovery run, batched like TitleTriage: classifies
// each relevant scraped job's ACTUAL seniority band from title+description —
// source-agnostic, replacing reliance on jobspy's LinkedIn-only job_level tag.
// This LABELS actual_job_level for client-side filtering; it does not gate the
// Evaluator call (see PromptSeeds.SeniorityClassification for the rationale).

public sealed record SeniorityClassifyRequest
{
    public List<SeniorityClassifyItem> Jobs { get; init; } = [];
}

public sealed record SeniorityClassifyItem
{
    public string JobId { get; init; } = "";
    public string Title { get; init; } = "";
    public string? Description { get; init; }
}

public sealed record SeniorityClassifyResponse
{
    public List<SeniorityClassifyResult> Results { get; init; } = [];
}

public sealed record SeniorityClassifyResult
{
    public string JobId { get; init; } = "";
    public string? Level { get; init; }
}
