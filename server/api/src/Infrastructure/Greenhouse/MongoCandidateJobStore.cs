using ApplicationTracker.Core.Greenhouse;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Greenhouse;

/// <summary>
/// <see cref="ICandidateJobStore"/> over Atlas <c>$vectorSearch</c>.
/// </summary>
/// <remarks>
/// <para>
/// Lives in Infrastructure, beside the embedding client it depends on, so the
/// API can resolve it without referencing the ingestion project. It reads the
/// collection the ingest writes and writes nothing itself.
/// </para>
/// <para>
/// Not user-scoped, and correctly so: the Greenhouse collection is shared
/// source data like the LinkedIn pool, and this returns job ids, not an opinion
/// about anyone. The profile arrives as an argument and is never stored.
/// </para>
/// </remarks>
public sealed class MongoCandidateJobStore : ICandidateJobStore
{
    private readonly IMongoCollection<BsonDocument> _jobs;
    private readonly IEmbeddingClient _embeddings;
    private readonly ILogger<MongoCandidateJobStore> _log;

    /// <summary>The Atlas Search index name. Must exist, and must be built for the configured dimensions.</summary>
    public const string IndexName = "greenhouse_vector_v1";

    /// <summary>
    /// How many index candidates to consider per returned result.
    /// </summary>
    /// <remarks>
    /// Atlas recommends 10-20x the limit. Lower is faster and recalls less; the
    /// cost of recalling less here is a relevant job the Evaluator never sees,
    /// which is invisible -- there is no signal anywhere that a good posting was
    /// filtered out before scoring. 15x is the middle of the recommended band.
    /// </remarks>
    public const int CandidateMultiplier = 15;

    public MongoCandidateJobStore(
        IMongoCollection<BsonDocument> jobs, IEmbeddingClient embeddings,
        ILogger<MongoCandidateJobStore> log)
    {
        _jobs = jobs;
        _embeddings = embeddings;
        _log = log;
    }

    public async Task<IReadOnlyList<string>> FindCandidateJobIds(
        string renderedProfile, CandidateJobFilters filters, int n, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(renderedProfile);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(n);

        // input_type "query", against the ingest's "document". Same model, same
        // dimensions, same client -- this argument is the ONLY difference, and
        // Voyage embeds the two asymmetrically on purpose.
        var embedded = await _embeddings.EmbedAsync([renderedProfile], "query", ct);

        if (embedded.Vectors.Count != 1)
            throw new EmbeddingException(
                $"Embedding the profile returned {embedded.Vectors.Count} vectors; expected 1.");

        var search = new BsonDocument
        {
            { "index", IndexName },
            { "path", GreenhouseJobFields.Embedding },
            { "queryVector", new BsonArray(embedded.Vectors[0].Select(v => (double)v)) },
            { "numCandidates", n * CandidateMultiplier },
            { "limit", n },
        };

        if (BuildFilter(filters) is { } filter)
            search.Add("filter", filter);

        var pipeline = new[]
        {
            new BsonDocument("$vectorSearch", search),
            // _id only. A prefilter that returned documents would invite the
            // caller to read a second source's job bodies through a retrieval
            // API, and this decides what gets scored -- not what gets shown.
            new BsonDocument("$project", new BsonDocument { { "_id", 1 } }),
        };

        var results = await _jobs.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);

        _log.LogInformation(
            "Greenhouse vector search: {Count} candidate(s) of {Requested} requested", results.Count, n);

        return [.. results.Select(d => d["_id"].ToString()!)];
    }

    /// <summary>
    /// The filter clause, applied INSIDE the index rather than after it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the point of declaring these fields in the index definition. A
    /// <c>$match</c> after <c>$vectorSearch</c> filters what the limit already
    /// truncated: ask for 200 and get however many of those 200 survive, which
    /// on a narrow filter is nearly none -- and it degrades silently, because a
    /// short result set looks exactly like a thin pool.
    /// </para>
    /// <para>
    /// <b>Every clause is "matches OR is unstated"</b>, which is
    /// <c>PoolJobRepository</c>'s rule and has to stay so. The extraction is
    /// best-effort; a job whose facts are missing must never become invisible
    /// to everyone. Greenhouse rows carry <c>extracted: null</c> until the
    /// extraction step runs, so without this every one of them would be
    /// filtered out and the prefilter would return an empty list that looks
    /// exactly like a pool with nothing suitable in it.
    /// </para>
    /// <para>
    /// <b>One deliberate divergence from the pool:</b> the pool matches
    /// location by regex (so "Israel" finds "Tel Aviv, Israel"), and an Atlas
    /// vector-search filter cannot express a regex. This matches exact values
    /// instead. Pass the values you want rather than a country stem, or leave
    /// Locations empty and let the vector do the work -- location is in the
    /// embedded text.
    /// </para>
    /// </remarks>
    private static BsonDocument? BuildFilter(CandidateJobFilters filters)
    {
        var clauses = new List<BsonDocument>();

        if (!filters.IncludeClosed)
            // A closed listing is kept forever and is still a perfect vector
            // match for the profile it was written for, so without this it
            // would crowd out live postings nobody can apply to.
            //
            // NOT permissive, unlike the others: closedAt is written by this
            // system on every row, so "unstated" cannot happen, and a missing
            // value would mean open in any case ($eq null matches both).
            clauses.Add(new BsonDocument(
                GreenhouseJobFields.ClosedAt, new BsonDocument("$eq", BsonNull.Value)));

        if (filters.Locations is { Count: > 0 } locations)
            clauses.Add(OrUnstated(GreenhouseJobFields.ExtractedLocation, locations));

        if (filters.Seniority is { Count: > 0 } seniority)
            clauses.Add(OrUnstated(GreenhouseJobFields.ExtractedSeniority, seniority));

        return clauses.Count switch
        {
            0 => null,
            1 => clauses[0],
            _ => new BsonDocument("$and", new BsonArray(clauses)),
        };
    }

    /// <summary>"This field is one of these values, or the posting did not say."</summary>
    /// <remarks>
    /// <c>$eq: null</c> matches a missing path as well as an explicit null, so
    /// it covers both a row with no <c>extracted</c> sub-document at all and
    /// one where the model read the posting and found nothing to say.
    /// <c>$exists</c> is not available in a vector-search filter.
    /// </remarks>
    private static BsonDocument OrUnstated(string path, IReadOnlyList<string> values) =>
        new("$or", new BsonArray
        {
            new BsonDocument(path, new BsonDocument("$in", new BsonArray(values))),
            new BsonDocument(path, new BsonDocument("$eq", BsonNull.Value)),
        });

    /// <summary>
    /// The Atlas Search index definition this store queries.
    /// </summary>
    /// <remarks>
    /// Kept next to the query rather than in a migration script, because the
    /// two have to agree on the field path, the dimension count and every
    /// filter field -- and a mismatch on any of them returns an empty result
    /// rather than an error.
    /// </remarks>
    public static BsonDocument IndexDefinition(int dimensions) => new()
    {
        { "fields", new BsonArray
            {
                new BsonDocument
                {
                    { "type", "vector" },
                    { "path", GreenhouseJobFields.Embedding },
                    { "numDimensions", dimensions },
                    // Cosine: Voyage returns normalised vectors, so cosine and
                    // dotProduct rank identically, and cosine stays correct if
                    // that ever stops being true.
                    { "similarity", "cosine" },
                },
                // Declared as filters so they are applied DURING the search.
                // The two extracted.* paths are the pool's own contract, so
                // this index keeps working unchanged when the extraction step
                // starts populating them.
                new BsonDocument { { "type", "filter" }, { "path", GreenhouseJobFields.ClosedAt } },
                new BsonDocument { { "type", "filter" }, { "path", GreenhouseJobFields.ExtractedLocation } },
                new BsonDocument { { "type", "filter" }, { "path", GreenhouseJobFields.ExtractedSeniority } },
            } },
    };
}
