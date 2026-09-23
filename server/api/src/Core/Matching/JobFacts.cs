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
    //
    // mustHaveTech is the FLAT list, kept because the pool's candidate filter
    // asks "does the posting name any tech this candidate has" with an $in over
    // it. It is derived from MustHaveGroups whenever groups are present
    // (JobFactsGroups.Normalize) and never read for counting.
    public string[] MustHaveTech { get; init; } = [];
    // The same requirements with their alternatives kept together: one inner
    // array is ONE requirement, met by any of its members. "Go, Ruby, or
    // Python" is [["Go","Ruby","Python"]] -- one requirement, not three. Stored
    // flat, a candidate with Python was counted as missing two requirements
    // the posting never made, and the Core Stack cap fired on a job they fit.
    [System.Text.Json.Serialization.JsonConverter(typeof(RequirementGroupsJsonConverter))]
    public string[][] MustHaveGroups { get; init; } = [];
    public string[] NiceToHaveTech { get; init; } = [];
    // One of the fixed bands, or null when the posting does not make it clear.
    public string? Seniority { get; init; }
    // Industry / problem area (e.g. "fintech", "cyber security"), null if unstated.
    public string? Domain { get; init; }
    // Normalized work location as the posting states it, including a remote or
    // hybrid marker when present.
    public string? Location { get; init; }
    // The kind of work: up to JobFunctions.MaxPerJob values from the fixed list,
    // empty when the posting does not make it clear. Normalized server-side, so
    // a value off the list never reaches storage.
    public string[] Functions { get; init; } = [];
}
