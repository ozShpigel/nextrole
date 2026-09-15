namespace ApplicationTracker.Core.Matching;

// Ingest-time parsing for the shared job pool: the Analyst's structured read of
// a posting, computed once when the job enters the pool and stored beside the
// raw text, exactly as job-facts already is.
//
// It is user-independent by construction — BuildAnalysisBatchPrompt takes no
// profile and the user message carries only the job id and its description, so
// there is no channel through which a candidate could change the result.
// Verified empirically as well: the same posting under two very different
// profiles produced byte-identical requests, and the outputs differed LESS
// across profiles than across repeat runs of the same profile. What varies is
// sampling, not the candidate.
//
// Anything that guards the Analyst's output has to run BEFORE a parse is
// stored, not after one is read back -- see VerbatimCulturalSignals for the
// worked example and the general rule. A check that was adequate when its
// subject was recomputed per user is not automatically adequate once the
// subject is shared and durable.
//
// Which is the whole reason to move it here. Running it per user meant every
// user re-parsed postings other users had already parsed, at 2.1x the cost of
// the entire global ingest pipeline, and it meant each user scored against
// their own dice roll of an extraction that is measurably unstable run to run.

public sealed record JobParseRequest
{
    public List<JobParseItem> Jobs { get; init; } = [];
}

public sealed record JobParseItem
{
    public string JobId { get; init; } = "";
    public string? Title { get; init; }
    public string? Company { get; init; }
    public string? Description { get; init; }
}

public sealed record JobParseResponse
{
    public List<JobParseResult> Results { get; init; } = [];
    // The stamp every result in this response was produced under. Returned
    // rather than assumed, so the caller stores what was actually used instead
    // of what it believes is current.
    public string ParseVersion { get; init; } = "";
}

public sealed record JobParseResult
{
    public string JobId { get; init; } = "";
    public ParsedJob Parsed { get; init; } = new();
}
