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

    /// <summary>
    /// 50 — see <see cref="IPoolJobRepository.MaxCandidatesPerScan"/>.
    /// </summary>
    /// <remarks>
    /// The pre-filter here leaves tens of jobs out of hundreds, in no
    /// particular order of fit, so the cap is a spend ceiling and not a
    /// relevance judgement: it stops a first-ever scan, or a profile edit that
    /// widens the filter, becoming an unbounded scoring bill in one request.
    /// What it leaves behind is picked up by the next visit.
    /// </remarks>
    public int MaxCandidatesPerScan => 50;

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

    public async Task<List<PoolJobListItem>> BrowseAsync(
        IReadOnlyCollection<string> jobIds, PoolBrowseQuery query, CancellationToken ct = default)
    {
        if (jobIds.Count == 0) return [];

        var b = Builders<BsonDocument>.Filter;
        var clauses = new List<FilterDefinition<BsonDocument>>
        {
            b.In("id", jobIds.Select(i => (BsonValue)i)),
            b.Ne("triaged_out", true),
        };

        // Recency means what the control says it means. Pool rows date from
        // first_seen_at; rows written before the pool existed carry only
        // discovered_at, so either satisfies it.
        if (query.DaysBack > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-query.DaysBack);
            clauses.Add(b.Or(
                b.Gte("first_seen_at", cutoff),
                b.And(b.Exists("first_seen_at", false), b.Gte("discovered_at", cutoff))));
        }

        if (!string.IsNullOrWhiteSpace(query.Location))
            clauses.Add(b.Regex("location", Contains(query.Location)));

        if (!string.IsNullOrWhiteSpace(query.Text))
        {
            var text = Contains(query.Text);
            clauses.Add(b.Or(
                b.Regex("title", text),
                b.Regex("company", text),
                b.Regex("description", text)));
        }

        if (query.IsRemote is { } remote)
            clauses.Add(b.Eq("is_remote", remote));

        if (query.Levels.Count > 0)
            clauses.Add(b.In("actual_job_level", query.Levels.Select(l => (BsonValue)l)));

        var docs = await _jobs
            .Find(b.And(clauses), new FindOptions { Collation = CaseInsensitive })
            .ToListAsync(ct);

        return docs.Select(ToListItem).ToList();
    }

    // Escaped: a company or location with a regex metacharacter in it
    // ("C++", "Tel Aviv (Center)") would otherwise either throw or match the
    // wrong rows. Case-insensitive substring, as the free-text controls imply.
    private static BsonRegularExpression Contains(string value) =>
        new(System.Text.RegularExpressions.Regex.Escape(value.Trim()), "i");

    private static PoolJobListItem ToListItem(BsonDocument d) => new()
    {
        Id = Str(d, "id") ?? "",
        Title = Str(d, "title") ?? "",
        Company = Str(d, "company") ?? "",
        Location = Str(d, "location"),
        Description = Str(d, "description"),
        JobUrl = Str(d, "job_url"),
        DatePosted = Str(d, "date_posted"),
        Site = Str(d, "site"),
        JobLevel = Str(d, "job_level"),
        ActualJobLevel = Str(d, "actual_job_level"),
        IsRemote = d.TryGetValue("is_remote", out var r) && r.IsBoolean ? r.AsBoolean : null,
        CompanyLogo = Str(d, "company_logo"),
        CompanyProfile = d.TryGetValue("company_profile", out var cp) && cp.IsBsonDocument
            ? cp.AsBsonDocument.ToDictionary(e => e.Name, e => (object?)(e.Value.IsBsonNull ? null : e.Value.ToString()))
            : null,
        IsDuplicate = d.TryGetValue("is_duplicate", out var dup) && dup.IsBoolean && dup.AsBoolean,
        DiscoveredAt = d.TryGetValue("discovered_at", out var da) && da.IsValidDateTime
            ? da.ToUniversalTime()
            : null,
        // LinkedIn carries no published range here; only the facts read's
        // estimate, written by the same shared extraction.
        Salary = JobSalary.From(null, SalaryDocument.Read(SalaryDocument.Extracted(d), "salary_estimate", estimate: true)),
    };

    public async Task<List<string>> FindIdsByJobUrlAsync(string jobUrl, CancellationToken ct = default)
    {
        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.Eq("job_url", jobUrl))
            .Project(Builders<BsonDocument>.Projection.Include("id"))
            .ToListAsync(ct);

        return docs
            .Select(d => d.TryGetValue("id", out var v) && v.IsString ? v.AsString : null)
            .Where(id => !string.IsNullOrEmpty(id))
            .Select(id => id!)
            .ToList();
    }

    public async Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(company)) return null;

        // Anchored and escaped: an exact company name, matched case-insensitively.
        // Without the escape a company with a regex metacharacter in its name
        // ("C++ Systems (Israel)") would either throw or match the wrong rows.
        var exact = new BsonRegularExpression(
            $"^{System.Text.RegularExpressions.Regex.Escape(company)}$", "i");

        var doc = await _jobs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.Regex("company", exact),
                Builders<BsonDocument>.Filter.Ne("company_logo", BsonNull.Value),
                Builders<BsonDocument>.Filter.Exists("company_logo")))
            .Sort(Builders<BsonDocument>.Sort.Descending("discovered_at"))
            .Project(Builders<BsonDocument>.Projection.Include("company_logo"))
            .FirstOrDefaultAsync(ct);

        return doc is not null && doc.TryGetValue("company_logo", out var logo) && logo.IsString
            ? logo.AsString
            : null;
    }

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
        MustHaveGroups = RequirementGroups.From(
            ExtractedGroups(d, "must_have_groups"), ExtractedStrings(d, "must_have_tech")),
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

    private static double? Dbl(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsNumeric ? v.ToDouble() : null;

    private static int? Int(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsNumeric ? v.ToInt32() : null;

    // extracted.<field> as a string array. Absent on rows that predate the
    // pool's extraction step, and on rows whose extraction was abandoned after
    // its retry cap — an empty list, which scoring reads as "the posting states
    // no requirements" and falls back to the Analyst for.
    // extracted.must_have_groups as written by the ingest: an array of string
    // arrays. Anything else in it is skipped rather than guessed at.
    private static string[][] ExtractedGroups(BsonDocument d, string field)
    {
        if (!d.TryGetValue("extracted", out var e) || !e.IsBsonDocument) return [];
        if (!e.AsBsonDocument.TryGetValue(field, out var v) || !v.IsBsonArray) return [];
        return [.. v.AsBsonArray
            .Where(g => g.IsBsonArray)
            .Select(g => g.AsBsonArray.Where(x => x.IsString).Select(x => x.AsString).ToArray())];
    }

    private static string[] ExtractedStrings(BsonDocument d, string field)
    {
        if (!d.TryGetValue("extracted", out var e) || !e.IsBsonDocument) return [];
        if (!e.AsBsonDocument.TryGetValue(field, out var v) || !v.IsBsonArray) return [];
        return v.AsBsonArray.Where(x => x.IsString).Select(x => x.AsString).ToArray();
    }

    private static string? Str(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsString ? v.AsString : null;
}
