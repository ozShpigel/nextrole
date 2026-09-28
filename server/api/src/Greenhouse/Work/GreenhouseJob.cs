using ApplicationTracker.Core.Greenhouse;
using System.Security.Cryptography;
using System.Text;
using MongoDB.Bson;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// One job as this source stores it, before the vector is attached.
/// </summary>
public sealed record GreenhouseJob
{
    /// <summary>The <see cref="IJobSource.Name"/> this job came from.</summary>
    public required string SourceName { get; init; }
    public required string BoardToken { get; init; }
    public required long GreenhouseJobId { get; init; }

    /// <summary>The source-qualified board, e.g. <c>greenhouse:wizinc</c>.</summary>
    public string BoardKey => KeyFor(SourceName, BoardToken);

    /// <summary>The board's own id, as the string every source can hold.</summary>
    public string SourceJobId => GreenhouseJobId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>One definition of a board key, shared with the backfill.</summary>
    public static string KeyFor(string sourceName, string boardToken) => $"{sourceName}:{boardToken}";
    public required string ContentHash { get; init; }
    public required string CleanedContent { get; init; }
    public required SourcePosting Source { get; init; }

    /// <summary>What actually gets embedded.</summary>
    /// <remarks>
    /// Title first, then the body. A posting's own text often never states the
    /// role plainly — it opens with three paragraphs about the company — and the
    /// title is the single highest-signal line for a recall prefilter.
    ///
    /// This string is NOT what the hash is computed over. The hash covers the
    /// cleaned body only, so that a board editing a job title does not look
    /// identical to an unchanged posting... which is why the title is part of
    /// the hash input too. See <see cref="From"/>.
    /// </remarks>
    public string EmbedText =>
        string.IsNullOrWhiteSpace(Source.Listed.Title) ? CleanedContent : $"{Source.Listed.Title}\n\n{CleanedContent}";

    /// <remarks>
    /// Cleaning happens here, for every source, rather than in each adapter:
    /// the cleaned text is what the hash covers, and one cleaner is one
    /// definition of "unchanged". <see cref="ContentCleaner"/> handles both
    /// entity-encoded HTML (Greenhouse) and plain HTML.
    /// </remarks>
    public static GreenhouseJob From(string sourceName, string boardToken, long jobId, SourcePosting job)
    {
        var cleaned = ContentCleaner.Clean(job.ContentHtml);

        // Hashed over exactly what we embed and store, title included. Anything
        // that changes the vector must change the hash, or a re-titled job keeps
        // a vector built from the old title forever -- the skip is permanent,
        // because the next run compares the same unchanged hash again.
        //
        // The title is length-prefixed rather than just concatenated so that
        // moving text across the title/body boundary cannot produce the same
        // digest from different content.
        var title = job.Listed.Title ?? "";
        var payload = $"{title.Length}{title}{cleaned}";

        return new GreenhouseJob
        {
            SourceName = sourceName,
            BoardToken = boardToken,
            GreenhouseJobId = jobId,
            CleanedContent = cleaned,
            ContentHash = Sha256(payload),
            Source = job,
        };
    }

    private static string Sha256(string text) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    /// <summary>
    /// The fields Mongo stores. Vector and timestamps are set by the writer.
    /// </summary>
    /// <remarks>
    /// <c>department</c> and <c>office</c> are stored as arrays of names even
    /// though the board also gives ids: the ids are Greenhouse's internal
    /// taxonomy and mean nothing outside one company's board, while the names
    /// are what a later narrowing query would actually filter on. Storing both
    /// halves of a taxonomy nobody has decided how to use yet is how a schema
    /// accumulates fields that look pending forever.
    ///
    /// <b>The whole board is kept.</b> Nothing here filters by department or
    /// title, so narrowing later is a query rather than a re-ingest.
    /// </remarks>
    public BsonDocument ToStoredFields() => new()
    {
        { GreenhouseJobFields.BoardToken, BoardToken },
        { GreenhouseJobFields.GreenhouseJobId, GreenhouseJobId },
        { GreenhouseJobFields.BoardKey, BoardKey },
        { GreenhouseJobFields.SourceJobId, SourceJobId },
        { GreenhouseJobFields.Title, Value(Source.Listed.Title) },
        { GreenhouseJobFields.Company, Value(Source.Company) },
        { GreenhouseJobFields.AbsoluteUrl, Value(Source.Url) },
        { GreenhouseJobFields.RequisitionId, Value(Source.RequisitionId) },
        { GreenhouseJobFields.Location, Value(Source.Listed.Location) },
        { GreenhouseJobFields.Department, Names(Source.Listed.Departments) },
        { GreenhouseJobFields.Office, Names(Source.Listed.Offices) },
        { GreenhouseJobFields.Content, CleanedContent },
        { GreenhouseJobFields.ContentHash, ContentHash },
        { GreenhouseJobFields.BoardUpdatedAt, Source.Listed.UpdatedAt is { } u ? u : BsonNull.Value },
        { GreenhouseJobFields.FirstPublishedAt, Source.Listed.PostedAt is { } f ? f : BsonNull.Value },
    };

    /// <summary>
    /// The extracted-fact fields, set only when a job first enters.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Written on INSERT only, never on update -- the pool's promise is that a
    /// posting's facts are read exactly once on entry, and re-running this on
    /// every upsert would reset the attempt counter and discard facts that had
    /// already been extracted.
    /// </para>
    /// <para>
    /// <b>A sub-document with explicit null leaves, NOT a null `extracted`.</b>
    /// That distinction is load-bearing and was found by running it. Atlas
    /// vector-search filters do not match a MISSING path: `extracted.seniority`
    /// with `$eq: null` returns nothing when `extracted` itself is null,
    /// because the path does not exist. Measured on this collection -- 0 hits
    /// with a null `extracted`, all of them once the leaves were written. And
    /// it fails the way everything in this file fails: an empty result set,
    /// indistinguishable from a pool with nothing suitable in it.
    /// </para>
    /// <para>
    /// Regular MQL would have hidden this, since `$eq: null` matches a missing
    /// field there and `$exists` is available as a fallback -- which is exactly
    /// what `PoolJobRepository` uses. A vector-search filter has neither.
    /// </para>
    /// <para>
    /// The shape stays compatible with the pool's permissive clauses: a null
    /// scalar satisfies its `Eq(field, null)` branch, and an empty array
    /// satisfies its `Size(field, 0)` branch. `extract_attempts: 0` remains the
    /// honest signal that nothing has read this posting yet.
    /// </para>
    /// </remarks>
    public static BsonDocument InitialExtractionFields() => new()
    {
        {
            GreenhouseJobFields.Extracted, new BsonDocument
            {
                { "location", BsonNull.Value },
                { "seniority", BsonNull.Value },
                { "must_have_tech", new BsonArray() },
                { "nice_to_have_tech", new BsonArray() },
                { "required_years", BsonNull.Value },
                { "domain", BsonNull.Value },
            }
        },
        { GreenhouseJobFields.ExtractedAt, BsonNull.Value },
        { GreenhouseJobFields.ExtractAttempts, 0 },
        { GreenhouseJobFields.Parsed, BsonNull.Value },
        { GreenhouseJobFields.ParsedAt, BsonNull.Value },
        { GreenhouseJobFields.ParsedWith, BsonNull.Value },
    };

    private static BsonValue Value(string? s) =>
        string.IsNullOrWhiteSpace(s) ? BsonNull.Value : new BsonString(s.Trim());

    /// <summary>Distinct taxonomy NAMES, as an array.</summary>
    /// <remarks>
    /// Names, not the ids the board also supplies: the ids are Greenhouse's
    /// internal taxonomy and mean nothing outside one company's board, while
    /// the names are what a later narrowing query would filter on. Storing both
    /// halves of a taxonomy nobody has decided how to use yet is how a schema
    /// accumulates fields that look pending forever.
    /// </remarks>
    private static BsonValue Names(IReadOnlyList<string> names)
    {
        if (names.Count == 0) return new BsonArray();

        return new BsonArray(names
            .Select(n => n.Trim())
            .Where(n => !string.IsNullOrEmpty(n))
            .Distinct(StringComparer.OrdinalIgnoreCase));
    }
}
