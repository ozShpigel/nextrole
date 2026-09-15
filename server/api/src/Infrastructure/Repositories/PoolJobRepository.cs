using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Repositories;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// Reads the shared job pool the scraper writes (docs/job-pool.md).
/// </summary>
/// <remarks>
/// BsonDocument rather than a typed model: the scraper owns this collection's
/// schema, and mapping it into a second source-of-truth C# record would make
/// every scraper-side field addition a breaking change here. Only the fields
/// scoring and display actually need are projected out.
///
/// No userId anywhere, on purpose. The pool is shared; this is the one
/// collection the API reads that is deliberately not user-scoped.
/// </remarks>
public sealed class PoolJobRepository : IPoolJobRepository
{
    // The extraction is best-effort, so "unknown" must never hide a job. Every
    // clause below is therefore "matches OR is unstated".
    private const string ExtractedLocation = "extracted.location";
    private const string ExtractedSeniority = "extracted.seniority";
    private const string ExtractedMustHave = "extracted.must_have_tech";

    // Tech names are compared case-insensitively via collation rather than by
    // storing a second lowercased copy of the array: one representation of the
    // data, and $in honours the query's collation.
    private static readonly Collation CaseInsensitive = new("en", strength: CollationStrength.Secondary);

    private readonly IMongoCollection<BsonDocument> _jobs;

    public PoolJobRepository(IMongoCollection<BsonDocument> jobs) => _jobs = jobs;

    private static FilterDefinition<BsonDocument> ActivePool =>
        Builders<BsonDocument>.Filter.And(
            // Pool membership: the criteria-driven path's rows have no pool_key.
            Builders<BsonDocument>.Filter.Exists("pool_key"),
            Builders<BsonDocument>.Filter.Ne("is_active", false),
            Builders<BsonDocument>.Filter.Ne("triaged_out", true));

    public async Task<List<PoolJob>> FindCandidatesAsync(
        CandidateFilter filter, IReadOnlyCollection<string> excludeJobIds, int limit, CancellationToken ct = default)
    {
        var b = Builders<BsonDocument>.Filter;
        var clauses = new List<FilterDefinition<BsonDocument>> { ActivePool };

        // Part of the query, not a post-filter: the scan is capped, so
        // without this every scan would hand back the same already-scored
        // first page and a backlog could never drain.
        if (excludeJobIds.Count > 0)
            clauses.Add(b.Nin("id", excludeJobIds.Select(i => (BsonValue)i)));

        if (!string.IsNullOrWhiteSpace(filter.LocationTerm))
        {
            var term = BsonRegularExpression.Create(
                new System.Text.RegularExpressions.Regex(
                    System.Text.RegularExpressions.Regex.Escape(filter.LocationTerm),
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase));
            clauses.Add(b.Or(
                b.Regex(ExtractedLocation, term),
                // A remote posting is reachable from anywhere, so location is
                // not a reason to drop it.
                b.Regex(ExtractedLocation, BsonRegularExpression.Create(
                    new System.Text.RegularExpressions.Regex("remote", System.Text.RegularExpressions.RegexOptions.IgnoreCase))),
                b.Eq("is_remote", true),
                b.Eq(ExtractedLocation, BsonNull.Value),
                b.Exists(ExtractedLocation, false)));
        }

        if (filter.SeniorityBands.Count > 0)
        {
            clauses.Add(b.Or(
                b.In(ExtractedSeniority, filter.SeniorityBands.Select(s => (BsonValue)s)),
                b.Eq(ExtractedSeniority, BsonNull.Value),
                b.Exists(ExtractedSeniority, false)));
        }

        if (filter.Tech.Count > 0)
        {
            clauses.Add(b.Or(
                b.In(ExtractedMustHave, filter.Tech.Select(t => (BsonValue)t)),
                // A posting that names no required technology is not evidence
                // against the candidate.
                b.Size(ExtractedMustHave, 0),
                b.Exists(ExtractedMustHave, false)));
        }

        var docs = await _jobs
            .Find(b.And(clauses), new FindOptions { Collation = CaseInsensitive })
            // Newest first: a backlog should surface the freshest postings,
            // since the per-scan cap means not everything gets scored today.
            .Sort(Builders<BsonDocument>.Sort.Descending("first_seen_at").Descending("discovered_at"))
            .Limit(limit)
            .ToListAsync(ct);

        return docs.Select(ToPoolJob).ToList();
    }

    public async Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> jobIds, CancellationToken ct = default)
    {
        var ids = jobIds.ToList();
        if (ids.Count == 0) return new List<PoolJob>();
        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.In("id", ids.Select(i => (BsonValue)i)))
            .ToListAsync(ct);
        return docs.Select(ToPoolJob).ToList();
    }

    public Task<long> CountActiveAsync(CancellationToken ct = default) =>
        _jobs.CountDocumentsAsync(ActivePool, cancellationToken: ct);

    private static PoolJob ToPoolJob(BsonDocument d) => new()
    {
        Id = Str(d, "id") ?? "",
        Title = Str(d, "title") ?? "",
        Company = Str(d, "company") ?? "",
        Location = Str(d, "location"),
        Description = Str(d, "description"),
        JobUrl = Str(d, "job_url"),
        DatePosted = Str(d, "date_posted"),
        CompanyLogo = Str(d, "company_logo"),
        CompanyProfile = d.TryGetValue("company_profile", out var cp) && cp.IsBsonDocument
            ? cp.AsBsonDocument.ToDictionary(e => e.Name, e => (object?)(e.Value.IsBsonNull ? null : e.Value.ToString()))
            : null,
        FirstSeenAt = d.TryGetValue("first_seen_at", out var f) && f.IsValidDateTime ? f.ToUniversalTime() : null,
        MustHaveTech = ExtractedStrings(d, "must_have_tech"),
        NiceToHaveTech = ExtractedStrings(d, "nice_to_have_tech"),
        Parsed = ParsedFrom(d),
        ParseVersion = Str(d, "parsed_with"),
    };

    // The ingest's stored Analyst read. Deserialized through the same JSON
    // contract the model produces, so the stored shape and the live shape
    // cannot drift: if ParsedJob changes incompatibly, this returns null and
    // the scan parses inline rather than scoring against a half-read job.
    private static ParsedJob? ParsedFrom(BsonDocument d)
    {
        if (!d.TryGetValue("parsed", out var v) || !v.IsBsonDocument) return null;
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<ParsedJob>(
                v.AsBsonDocument.ToJson(), ParsedJson);
        }
        catch (Exception)
        {
            // A stored parse we cannot read is the same as no stored parse.
            // Never throw here: that would take down a scan over a cache miss.
            return null;
        }
    }

    private static readonly System.Text.Json.JsonSerializerOptions ParsedJson = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    // extracted.<field> as a string array. Absent on rows that predate the
    // pool's extraction step, and on rows whose extraction was abandoned after
    // its retry cap — an empty list, which scoring reads as "the posting states
    // no requirements" and falls back to the Analyst for.
    private static string[] ExtractedStrings(BsonDocument d, string field)
    {
        if (!d.TryGetValue("extracted", out var e) || !e.IsBsonDocument) return [];
        if (!e.AsBsonDocument.TryGetValue(field, out var v) || !v.IsBsonArray) return [];
        return v.AsBsonArray.Where(x => x.IsString).Select(x => x.AsString).ToArray();
    }

    private static string? Str(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsString ? v.AsString : null;
}
