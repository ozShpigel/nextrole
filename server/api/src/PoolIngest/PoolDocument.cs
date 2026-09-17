using MongoDB.Bson;

namespace ApplicationTracker.PoolIngest;

/// <summary>
/// The <c>discovered_jobs</c> document a new pool listing is stored as.
/// </summary>
/// <remarks>
/// Built as a <see cref="BsonDocument"/> rather than mapped from a typed model,
/// deliberately. The collection has ~3,700 documents written by the scraper's
/// pydantic model, and the field names, their casing and which ones are present
/// are all history this has to match. A typed model would invite tidying that
/// history up — renaming a field, dropping a null — and every such tidy is a
/// silent divergence from documents the API already reads.
///
/// Fields the scraper's model set to a constant null are omitted rather than
/// written as null: <c>criteria_id</c> and the retired scoring fields. The
/// reader treats absent and null identically, and writing nulls for things
/// nothing can produce is what made the enrichment columns look pending for a
/// year (docs/scraper-slimming.md).
/// </remarks>
public static class PoolDocument
{
    public static BsonDocument Build(
        ScrapedJob job,
        string poolKey,
        string runId,
        DateTime now,
        BsonDocument? facts,
        BsonDocument? parsed,
        string? parseVersion)
    {
        var doc = new BsonDocument
        {
            { "id", job.Id },
            { "run_id", runId },
            // Null, not absent: the pool is not driven by a saved search, and
            // the browse path distinguishes pool rows from criteria-era ones by
            // exactly this field being null.
            { "criteria_id", BsonNull.Value },

            { "title", job.Title },
            { "company", job.Company },
            { "location", Value(job.Location) },
            { "description", Value(job.Description) },
            { "job_url", Value(job.JobUrl) },
            { "date_posted", Value(job.DatePosted) },
            { "site", job.Site ?? "linkedin" },
            { "job_level", Value(job.JobLevel) },

            // One seniority field, one writer: on this path the extraction is
            // it, so nothing downstream has to know which pipeline filled it.
            { "actual_job_level", facts?.GetValue("seniority", BsonNull.Value) ?? BsonNull.Value },

            { "is_remote", job.IsRemote is { } remote ? remote : BsonNull.Value },
            { "company_logo", Value(job.CompanyLogo) },
            { "company_profile", Profile(job.CompanyProfile) },

            // Pool rows opt out of retention: an expired listing is marked
            // inactive, never deleted. The TTL index only touches ttl_managed.
            { "ttl_managed", false },

            { "pool_key", poolKey },
            { "is_active", true },
            { "missed_runs", 0 },
            { "first_seen_at", now },
            { "last_seen_at", now },
            { "last_seen_run_id", runId },

            { "extracted", facts ?? (BsonValue)BsonNull.Value },
            { "extracted_at", facts is not null ? now : BsonNull.Value },
            { "extract_attempts", 1 },

            { "parsed", parsed ?? (BsonValue)BsonNull.Value },
            { "parsed_at", parsed is not null ? now : BsonNull.Value },
            { "parsed_with", parsed is not null ? Value(parseVersion) : BsonNull.Value },

            { "is_duplicate", false },
            { "triaged_out", false },
            { "discovered_at", now },
        };

        return doc;
    }

    private static BsonValue Value(string? s) =>
        string.IsNullOrEmpty(s) ? BsonNull.Value : new BsonString(s);

    private static BsonValue Profile(Dictionary<string, object?>? profile)
    {
        if (profile is null || profile.Count == 0) return BsonNull.Value;

        var doc = new BsonDocument();
        foreach (var (key, value) in profile)
            if (value is not null)
                doc.Add(key, BsonValue.Create(value.ToString()));

        return doc.ElementCount == 0 ? BsonNull.Value : doc;
    }
}

/// <summary>
/// One row of <c>discovery_runs</c>: what a run did, and whether it worked.
/// </summary>
/// <remarks>
/// Only the counters a pool run actually sets. The scraper's model carried
/// another fifteen from the criteria path and the RAG era, all written as
/// zeroes on every pool run; a reader cannot tell a counter that means zero
/// from one nothing writes. The two read-only run endpoints tolerate absent
/// fields, and the daily digest reads the log line rather than this document.
/// </remarks>
public sealed class RunRecord
{
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public string Status { get; set; } = "pending";
    public DateTime StartedAt { get; init; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? Error { get; set; }

    public int JobsScraped { get; set; }
    public long JobsAlreadyKnown { get; set; }
    public int JobsNew { get; set; }
    public int JobsExtracted { get; set; }
    public int JobsParsed { get; set; }
    public int JobsExtractRetried { get; set; }
    public int JobsExtractAbandoned { get; set; }
    public long JobsMissed { get; set; }
    public long JobsMarkedInactive { get; set; }

    public int SearchesTotal { get; set; }
    public int SearchesFailed { get; set; }
    public int SearchesEmpty { get; set; }

    public static RunRecord Start() => new();

    public BsonDocument ToDocument() => new()
    {
        { "id", Id },
        // "pool" rather than a criteria id: the run history endpoint groups by
        // this, and the digest's Loki filter keys on source=pool.
        { "criteria_id", "pool" },
        { "criteria_name", "Shared job pool" },
        { "status", Status },
        { "started_at", StartedAt },
        { "completed_at", CompletedAt is { } c ? c : BsonNull.Value },
        { "error", Error is null ? BsonNull.Value : new BsonString(Error) },
        { "jobs_scraped", JobsScraped },
        { "jobs_already_known", JobsAlreadyKnown },
        { "jobs_new", JobsNew },
        { "jobs_extracted", JobsExtracted },
        { "jobs_parsed", JobsParsed },
        { "jobs_extract_retried", JobsExtractRetried },
        { "jobs_extract_abandoned", JobsExtractAbandoned },
        { "jobs_missed", JobsMissed },
        { "jobs_marked_inactive", JobsMarkedInactive },
        { "searches_total", SearchesTotal },
        { "searches_failed", SearchesFailed },
        { "searches_empty", SearchesEmpty },
    };
}
