namespace ApplicationTracker.Core.Matching;

// Per-job extraction for the shared job pool: what a posting asks for, read
// once when the job first enters the pool and stored beside the raw text.
//
// Deliberately user-independent — no profile, no scoring, no judgement about
// fit. That is what makes it safe to compute once and reuse for every user:
// the cheap per-user filter (Step 5) reads these fields, and only the jobs
// that survive it are ever scored against a profile.

public sealed record JobFactsRequest
{
    public List<JobFactsItem> Jobs { get; init; } = [];
}

public sealed record JobFactsItem
{
    public string JobId { get; init; } = "";
    public string Title { get; init; } = "";
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? Description { get; init; }
}

public sealed record JobFactsResponse
{
    public List<JobFacts> Results { get; init; } = [];
}

public sealed record JobFacts
{
    public string JobId { get; init; } = "";
    // Years of experience the posting actually asks for; null when it does not
    // say. Never inferred from seniority words — "Senior" is not "5 years".
    public int? RequiredYears { get; init; }
    // Technologies stated as requirements vs. stated as a plus. A posting that
    // does not separate them puts everything in mustHaveTech.
    public string[] MustHaveTech { get; init; } = [];
    public string[] NiceToHaveTech { get; init; } = [];
    // One of the fixed bands, or null when the posting does not make it clear.
    public string? Seniority { get; init; }
    // Industry / problem area (e.g. "fintech", "cyber security"), null if unstated.
    public string? Domain { get; init; }
    // Normalized work location as the posting states it, including a remote or
    // hybrid marker when present.
    public string? Location { get; init; }
}
