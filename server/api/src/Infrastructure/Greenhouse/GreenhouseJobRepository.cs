using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Greenhouse;

/// <summary>
/// <see cref="IPoolJobRepository"/> over <c>greenhouse_jobs</c>, retrieving by
/// vector similarity instead of by Mongo field match.
/// </summary>
/// <remarks>
/// <para>
/// Implements the pool's own interface deliberately. Swapping the source is
/// then a single DI registration: <c>PoolScanService</c>, <c>PoolBrowseService</c>
/// and every endpoint above them are untouched, and switching back is the same
/// one-line change. Nothing here reads <c>discovered_jobs</c>.
/// </para>
/// <para>
/// Not user-scoped, for the same reason the pool is not: this collection is
/// shared source data, and per-user opinion lives in <c>jobScores</c>.
/// </para>
/// </remarks>
public sealed class GreenhouseJobRepository : IPoolJobRepository
{
    private readonly IMongoCollection<BsonDocument> _jobs;
    private readonly ICandidateJobStore _vectors;
    private readonly ILogger<GreenhouseJobRepository> _log;

    /// <summary>
    /// How many vector hits to pull back per job actually wanted.
    /// </summary>
    /// <remarks>
    /// <b>Over-fetch, then filter in memory.</b> An Atlas vector-search filter
    /// cannot express a regex, and the extraction's location values do not
    /// survive exact matching: measured across 134 real postings, "London"
    /// arrives as ten distinct strings -- <c>London, United Kingdom</c>,
    /// <c>London, UK (hybrid)</c>, <c>Cardiff, London or Remote (UK) (hybrid)</c>,
    /// <c>United Kingdom (remote)</c> and <c>London (hybrid)</c> among them,
    /// with country and city each sometimes absent. An <c>$in</c> list would
    /// need maintaining forever and would silently miss whatever it had not
    /// seen yet.
    ///
    /// So the vector does the ranking with only <c>closedAt</c> applied inside
    /// the index, and the location match happens here where substring logic is
    /// available -- the same forgiving comparison the pool does with a regex.
    /// </remarks>
    public const int OverFetchFactor = 10;

    /// <summary>Never ask the index for fewer than this, however small the limit.</summary>
    /// <remarks>
    /// A limit of 5 with a narrow location filter would otherwise over-fetch 50
    /// and could still find nothing matching. The floor costs nothing -- the
    /// search is ~95ms regardless of limit -- and buys the post-filter room to
    /// work.
    /// </remarks>
    public const int MinOverFetch = 200;

    /// <summary>
    /// 10 — see <see cref="IPoolJobRepository.MaxCandidatesPerScan"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Measured, not reasoned.</b> This was 5, on the argument that a ranked
    /// source puts the best matches at the top so the top few ARE the answer.
    /// That argument is wrong, and scoring 30 deep for one real profile showed
    /// why: cosine similarity correlates +0.65 with the eventual score across
    /// the whole set, but <b>-0.15 within the top ten</b>. It sorts the field
    /// and not the leaderboard -- which is exactly what a recall prefilter is
    /// for, and means rank cannot stand in for quality.
    /// </para>
    /// <para>
    /// Concretely: ranks 1-10 averaged 53-56 and were statistically
    /// indistinguishable, rank 11 onward fell to 37, and the two
    /// highest-scoring postings sat at ranks 7 and 10 -- both invisible at a
    /// cap of 5. At 10 the selection found all five of the genuinely best
    /// jobs; the perfect ordering would have averaged 56.4 against this
    /// ordering's 54.2, so there is little left to win.
    /// </para>
    /// <para>
    /// Ten is also two whole scoring batches, so nothing is wasted on a
    /// part-filled one.
    /// </para>
    /// </remarks>
    public const int DefaultMaxCandidatesPerScan = 10;

    /// <summary>Whether postings of another kind of work are dropped, or only counted.</summary>
    /// <remarks>
    /// Off by default, deliberately. A confident wrong function label hides a
    /// job with no symptom, and there is no exact check for "right label"
    /// (<see cref="JobFunctions"/>). So the filter runs either way and logs what
    /// it WOULD drop; the labels on stored postings are read first, and only
    /// then is <c>Greenhouse:FilterByFunction</c> switched on.
    /// </remarks>
    private readonly bool _filterByFunction;

    public GreenhouseJobRepository(
        IMongoCollection<BsonDocument> jobs, ICandidateJobStore vectors,
        ILogger<GreenhouseJobRepository> log,
        int maxCandidatesPerScan = DefaultMaxCandidatesPerScan,
        bool filterByFunction = false)
    {
        _jobs = jobs;
        _vectors = vectors;
        _log = log;
        _filterByFunction = filterByFunction;
        MaxCandidatesPerScan = maxCandidatesPerScan > 0
            ? maxCandidatesPerScan
            : DefaultMaxCandidatesPerScan;
    }

    /// <inheritdoc />
    public int MaxCandidatesPerScan { get; }

    private static FilterDefinition<BsonDocument> Open =>
        Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.ClosedAt, BsonNull.Value);

    /// <summary>
    /// Jobs worth scoring for this profile: vector-ranked, location-filtered,
    /// minus anything this user already has a score for.
    /// </summary>
    public async Task<List<PoolJob>> FindCandidatesAsync(
        CandidateFilter filter, IReadOnlyCollection<string> excludeJobIds, int limit,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(filter.ProfileText))
        {
            // Without profile text there is nothing to embed, and returning an
            // arbitrary slice of the collection would look like a working scan.
            _log.LogWarning("Candidate search asked for with no profile text; returning nothing");
            return [];
        }

        var fetch = Math.Max(MinOverFetch, limit * OverFetchFactor);

        var ids = await _vectors.FindCandidateJobIds(
            filter.ProfileText, new CandidateJobFilters(), fetch, ct);

        if (ids.Count == 0) return [];

        // Ranked order is the vector's answer and must survive the round trip
        // through Mongo, which returns documents in whatever order it likes.
        var rank = ids.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);

        var exclude = excludeJobIds as HashSet<string> ?? [.. excludeJobIds];

        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.And(
                Builders<BsonDocument>.Filter.In("_id", ids.Select(ObjectId.Parse)),
                Open,
                // A posting whose parse is still in an open batch waits for it.
                // Scored now, it would be parsed inline at full price for every
                // user who reaches it -- the cost the batch exists to halve --
                // and, if new, scored before its facts could filter it.
                Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.AiPendingParse, BsonNull.Value)))
            .ToListAsync(ct);

        // Kept separate from the Take below so the log can report them
        // separately. Conflating the two reads as "the location filter cut 132
        // to 6" when the limit did most of the cutting -- measured once at 44
        // matched and 6 returned, off by a factor of seven for anyone
        // diagnosing recall.
        var located = docs
            .Select(ToPoolJob)
            .Where(j => !exclude.Contains(j.Id))
            .Where(j => MatchesLocation(j, filter.LocationTerm, filter.LocationText))
            .Where(j => MatchesSeniority(j, filter.SeniorityBands))
            .OrderBy(j => rank.TryGetValue(j.Id, out var r) ? r : int.MaxValue)
            .ToList();

        // Computed whether or not it is applied: the count is the evidence for
        // switching it on, and afterwards the evidence that it is not hiding
        // too much.
        var otherWork = located.Where(j => !JobFunctions.Matches(j.Functions, filter.Functions)).ToList();
        if (otherWork.Count > 0)
            _log.LogInformation(
                "Greenhouse function filter ({State}): {Count} of {Total} posting(s) are outside {Accepted} -- {Postings}",
                _filterByFunction ? "applied" : "counting only",
                otherWork.Count, located.Count, string.Join("/", filter.Functions),
                // Titles with their labels, so a wrong label is readable in the
                // log -- which is how the labels get checked before this is on.
                string.Join("; ", otherWork.Take(20).Select(j => $"{j.Title} [{string.Join("+", j.Functions)}]")));

        List<PoolJob> matched = _filterByFunction ? [.. located.Except(otherWork)] : located;

        var candidates = matched.Take(limit).ToList();

        _log.LogInformation(
            "Greenhouse candidates: {Fetched} vector hit(s), {Excluded} already scored, "
            + "{Matched} in {Term} at {Bands}, returning top {Returned} of those (limit {Limit})",
            ids.Count, exclude.Count, matched.Count, filter.LocationTerm ?? "(any)",
            filter.SeniorityBands.Count > 0 ? string.Join("/", filter.SeniorityBands) : "(any level)",
            candidates.Count, limit);

        return candidates;
    }

    /// <summary>
    /// Whether a posting's extracted seniority is one the candidate would want.
    /// </summary>
    /// <remarks>
    /// The same rule the LinkedIn pool applies in its Mongo query
    /// (<c>PoolJobRepository</c>): the band must be one of
    /// <see cref="CandidateFilter.SeniorityBands"/> -- the candidate's own and
    /// one either side -- and a posting with no stated band passes. It was
    /// missing here, so a senior engineer's board carried "New Grad" roles, and
    /// each one cost a Claude call when the reader scrolled to it.
    /// </remarks>
    public static bool MatchesSeniority(PoolJob job, IReadOnlyList<string> bands)
    {
        if (bands.Count == 0) return true;
        if (string.IsNullOrWhiteSpace(job.Seniority)) return true;   // unstated passes
        return bands.Contains(job.Seniority.Trim(), StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Whether a posting's extracted location satisfies the candidate's term.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Substring, case-insensitive, and <b>permissive on absence</b> — the
    /// pool's rule, and the extraction is best-effort, so a job whose location
    /// could not be read must never become invisible to everyone.
    /// </para>
    /// <para>
    /// "UK" and "United Kingdom" are treated as the same thing because the
    /// extraction genuinely emits both, on the same board, for the same city.
    /// This is a small, explicit alias list rather than a general gazetteer:
    /// anything cleverer would be guessing, and a wrong guess silently hides
    /// jobs.
    /// </para>
    /// </remarks>
    public static bool MatchesLocation(PoolJob job, string? term, string? candidateLocation = null)
    {
        if (string.IsNullOrWhiteSpace(term)) return true;

        var location = job.Location;
        if (string.IsNullOrWhiteSpace(location)) return true;   // unstated passes

        foreach (var candidate in Aliases(term.Trim()))
            if (location.Contains(candidate, StringComparison.OrdinalIgnoreCase))
                return true;

        // The other direction, for the posting that names a city and no
        // country: "London" holds neither "UK" nor "United Kingdom", so the
        // loop above cannot see it, and 14 of 132 real postings were exactly
        // that. Asking whether the CANDIDATE's stated location contains the
        // POSTING's needs no city extraction and no gazetteer -- "Open to
        // relocation to London, UK" contains "London", and contains neither
        // "Barcelona" nor "Tel Aviv, Israel".
        return ContainsAsWords(candidateLocation, location);
    }

    /// <summary>
    /// Whether <paramref name="haystack"/> contains <paramref name="needle"/>
    /// as a whole word (or whole run of words), ignoring case.
    /// </summary>
    /// <remarks>
    /// Word-bounded rather than a plain substring because the needle here is a
    /// posting's location, and a short one is a substring of ordinary text by
    /// accident: a posting in <c>"NY"</c> would otherwise match a candidate in
    /// <c>"Penny Lane, UK"</c>. Boundaries cost nothing and remove that whole
    /// class of false positive.
    /// </remarks>
    private static bool ContainsAsWords(string? haystack, string needle)
    {
        if (string.IsNullOrWhiteSpace(haystack)) return false;

        var trimmed = needle.Trim();
        if (trimmed.Length == 0) return false;

        return System.Text.RegularExpressions.Regex.IsMatch(
            haystack,
            $@"(?<![\p{{L}}\p{{N}}]){System.Text.RegularExpressions.Regex.Escape(trimmed)}(?![\p{{L}}\p{{N}}])",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static IEnumerable<string> Aliases(string term)
    {
        yield return term;

        // Measured on the real collection: the extraction writes both
        // "London, United Kingdom" and "London, UK (hybrid)".
        if (term.Equals("United Kingdom", StringComparison.OrdinalIgnoreCase)) yield return "UK";
        if (term.Equals("UK", StringComparison.OrdinalIgnoreCase)) yield return "United Kingdom";
        if (term.Equals("United States", StringComparison.OrdinalIgnoreCase)) yield return "USA";
        if (term.Equals("USA", StringComparison.OrdinalIgnoreCase)) yield return "United States";
    }

    public async Task<List<PoolJob>> GetByIdsAsync(IEnumerable<string> jobIds, CancellationToken ct = default)
    {
        var ids = jobIds.Where(IsObjectId).Select(ObjectId.Parse).ToList();
        if (ids.Count == 0) return [];

        var docs = await _jobs.Find(Builders<BsonDocument>.Filter.In("_id", ids)).ToListAsync(ct);
        return [.. docs.Select(ToPoolJob)];
    }

    public Task<long> CountActiveAsync(CancellationToken ct = default) =>
        _jobs.CountDocumentsAsync(Open, cancellationToken: ct);

    /// <summary>The Matches page's read over ids this user has scores for.</summary>
    public async Task<List<PoolJobListItem>> BrowseAsync(
        IReadOnlyCollection<string> jobIds, PoolBrowseQuery query, CancellationToken ct = default)
    {
        var ids = jobIds.Where(IsObjectId).Select(ObjectId.Parse).ToList();
        if (ids.Count == 0) return [];

        var b = Builders<BsonDocument>.Filter;
        var clauses = new List<FilterDefinition<BsonDocument>>
        {
            b.In("_id", ids),
            Open,
        };

        // The Matches filters, which this source used to ignore silently: the
        // client sent them, the text search was the only one applied, and the
        // chips appeared to work while filtering nothing. Same meanings as
        // PoolJobRepository.BrowseAsync, over this collection's fields.
        //
        // DaysBack is deliberately NOT applied. It means "first seen within N
        // days" and defaults to 14, which suited LinkedIn listings that aged
        // out; a Greenhouse board keeps a role open for months, so honouring it
        // would drop every scored job older than two weeks from the default
        // board. It needs a meaning for this source first (and the band, which
        // calls this with the default query, would need exempting).

        if (!string.IsNullOrWhiteSpace(query.Location))
        {
            var location = ContainsText(query.Location);
            clauses.Add(b.Or(
                b.Regex(GreenhouseJobFields.ExtractedLocation, location),
                b.Regex(GreenhouseJobFields.Location, location)));
        }

        // No is_remote field on this source: the extraction writes the
        // arrangement into the location ("London, UK (remote)"), so that is the
        // only place the answer exists.
        if (query.IsRemote is { } remote)
        {
            var isRemote = b.Regex(GreenhouseJobFields.ExtractedLocation, new BsonRegularExpression("remote", "i"));
            clauses.Add(remote ? isRemote : b.Not(isRemote));
        }

        if (query.Levels.Count > 0)
            clauses.Add(b.In(GreenhouseJobFields.ExtractedSeniority, query.Levels.Select(l => (BsonValue)l)));

        // The same rule and the same switch as the candidate search, so a board
        // cannot show what the scan now refuses to score. Unread (absent) and
        // unclear (empty) both pass.
        if (_filterByFunction && query.Functions.Count > 0)
            clauses.Add(b.Or(
                b.In(GreenhouseJobFields.ExtractedFunctions, query.Functions.Select(f => (BsonValue)f)),
                b.Exists(GreenhouseJobFields.ExtractedFunctions, false),
                b.Size(GreenhouseJobFields.ExtractedFunctions, 0)));

        if (!string.IsNullOrWhiteSpace(query.Text))
        {
            var term = BsonRegularExpression.Create(
                new System.Text.RegularExpressions.Regex(
                    System.Text.RegularExpressions.Regex.Escape(query.Text!),
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase));

            clauses.Add(Builders<BsonDocument>.Filter.Or(
                Builders<BsonDocument>.Filter.Regex(GreenhouseJobFields.Title, term),
                Builders<BsonDocument>.Filter.Regex(GreenhouseJobFields.Company, term),
                Builders<BsonDocument>.Filter.Regex(GreenhouseJobFields.Content, term)));
        }

        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.And(clauses))
            .SortByDescending(d => d[GreenhouseJobFields.FirstSeenAt])
            .ToListAsync(ct);

        return [.. docs.Select(ToListItem)];
    }

    private static BsonRegularExpression ContainsText(string value) =>
        new(System.Text.RegularExpressions.Regex.Escape(value.Trim()), "i");

    /// <summary>
    /// Greenhouse ids sharing a posting URL.
    /// </summary>
    /// <remarks>
    /// Singular in practice, unlike the pool: <c>(boardToken, greenhouseJobId)</c>
    /// is unique, so one posting is one row. Still returns a list because the
    /// interface promises one and a caller must not assume otherwise.
    /// </remarks>
    public async Task<List<string>> FindIdsByJobUrlAsync(string jobUrl, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(jobUrl)) return [];

        var docs = await _jobs
            .Find(Builders<BsonDocument>.Filter.Eq(GreenhouseJobFields.AbsoluteUrl, jobUrl))
            .Project(Builders<BsonDocument>.Projection.Include("_id"))
            .ToListAsync(ct);

        return [.. docs.Select(d => d["_id"].ToString()!)];
    }

    /// <summary>
    /// Nothing to borrow.
    /// </summary>
    /// <remarks>
    /// The ingest stamps a board's logo on every row of that board at once
    /// (<c>JobStore.StampCompanyLogoAsync</c>), so a job with no logo belongs to
    /// a company whose domain is not configured, and so do its siblings.
    /// Looking one up would find the same null.
    /// </remarks>
    public Task<string?> FindCompanyLogoAsync(string company, CancellationToken ct = default) =>
        Task.FromResult<string?>(null);

    private static bool IsObjectId(string id) => ObjectId.TryParse(id, out _);

    private static PoolJob ToPoolJob(BsonDocument d) => new()
    {
        Id = d["_id"].ToString()!,
        Title = Str(d, GreenhouseJobFields.Title) ?? "",
        Company = Str(d, GreenhouseJobFields.Company) ?? "",
        // The EXTRACTED location, not the board's raw text: it is the
        // normalised one, and the one the post-filter above compares.
        Location = ExtractedStr(d, "location") ?? Str(d, GreenhouseJobFields.Location),
        Description = Str(d, GreenhouseJobFields.Content),
        JobUrl = Str(d, GreenhouseJobFields.AbsoluteUrl),
        CompanyLogo = Str(d, GreenhouseJobFields.CompanyLogo),
        FirstSeenAt = Date(d, GreenhouseJobFields.FirstSeenAt),
        MustHaveTech = ExtractedStrings(d, "must_have_tech"),
        MustHaveGroups = RequirementGroups.From(
            ExtractedGroups(d, "must_have_groups"), ExtractedStrings(d, "must_have_tech")),
        Seniority = ExtractedStr(d, "seniority"),
        Functions = ExtractedStrings(d, "functions"),
        NiceToHaveTech = ExtractedStrings(d, "nice_to_have_tech"),
        // The ingest's Analyst read. Null falls through to an inline parse for
        // that job alone -- the behaviour that existed before the cache, so a
        // miss is never worse than no cache.
        Parsed = d.TryGetValue(GreenhouseJobFields.Parsed, out var p) && p.IsBsonDocument
            ? ParsedJobFrom(p.AsBsonDocument)
            : null,
        // Greenhouse carries no company enrichment: the boards API returns no
        // news and no reviews. Null rather than empty, because the field should
        // say what is known and nothing is.
        //
        // The consequence is that PaceEvidence.In is false for every posting
        // from this source, so Sustainability & Pace is dropped from the total
        // and the score renormalised over the rest (ScoreTotal). That is not a
        // Greenhouse quirk any more: the pool's Glassdoor scraper is gone too,
        // so no live source supplies pace evidence.
        CompanyNews = null,
        GlassdoorData = null,
    };

    private static PoolJobListItem ToListItem(BsonDocument d) => new()
    {
        Id = d["_id"].ToString()!,
        Title = Str(d, GreenhouseJobFields.Title) ?? "",
        Company = Str(d, GreenhouseJobFields.Company) ?? "",
        Location = ExtractedStr(d, "location") ?? Str(d, GreenhouseJobFields.Location),
        Description = Str(d, GreenhouseJobFields.Content),
        JobUrl = Str(d, GreenhouseJobFields.AbsoluteUrl),
        CompanyLogo = Str(d, GreenhouseJobFields.CompanyLogo),
        // The board's own seniority read, so the Matches filters keep working.
        ActualJobLevel = ExtractedStr(d, "seniority"),
        DiscoveredAt = Date(d, GreenhouseJobFields.FirstSeenAt),
        Site = "greenhouse",
    };

    private static ParsedJob? ParsedJobFrom(BsonDocument doc)
    {
        try
        {
            return MongoDB.Bson.Serialization.BsonSerializer.Deserialize<ParsedJob>(doc);
        }
        catch (Exception)
        {
            // A stored parse that will not deserialise must not fail the scan:
            // null means "parse it inline", which is a slower correct answer.
            return null;
        }
    }

    private static string? Str(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsString ? v.AsString : null;

    private static DateTime? Date(BsonDocument d, string field) =>
        d.TryGetValue(field, out var v) && v.IsValidDateTime ? v.ToUniversalTime() : null;

    private static string? ExtractedStr(BsonDocument d, string field) =>
        d.TryGetValue(GreenhouseJobFields.Extracted, out var e) && e.IsBsonDocument
        && e.AsBsonDocument.TryGetValue(field, out var v) && v.IsString
            ? v.AsString
            : null;

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
        if (!d.TryGetValue(GreenhouseJobFields.Extracted, out var e) || !e.IsBsonDocument) return [];
        if (!e.AsBsonDocument.TryGetValue(field, out var v) || !v.IsBsonArray) return [];
        return [.. v.AsBsonArray.Where(x => x.IsString).Select(x => x.AsString)];
    }
}
