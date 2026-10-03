namespace ApplicationTracker.Core.Matching;

public sealed record MatchRequest
{
    public required string JobDescription { get; init; }

    // Optional pre-parsed metadata. When present, the parse step is skipped.
    public string? Title { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? DatePosted { get; init; }
    public string? Site { get; init; }

    // Company profile fields jobspy captures on every scrape (industry, size,
    // revenue, description, url) — free, no extra HTTP call. Context/narrative
    // only — never changes numeric scores.
    public CompanyProfile? CompanyProfile { get; init; }

    // Optional profile override: when present, scored against this instead of
    // the stored profile (rendered via ProfileRenderer, same as the normal
    // path — never a pre-rendered string). Lets eval harnesses score against a
    // frozen profile instead of whatever is currently in Mongo. Single-job
    // path only; the batch path always uses the stored profile.
    public ApplicationTracker.Core.Profile.StructuredProfile? Profile { get; init; }
}

public sealed record CompanyProfile
{
    public string? Industry { get; init; }
    public string? Description { get; init; }
    public string? NumEmployees { get; init; }
    public string? Revenue { get; init; }
    public string? Url { get; init; }
}
