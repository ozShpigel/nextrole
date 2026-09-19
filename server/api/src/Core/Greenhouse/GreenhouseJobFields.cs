namespace ApplicationTracker.Core.Greenhouse;

/// <summary>
/// The <c>greenhouse_jobs</c> document model: one name per stored field.
/// </summary>
/// <remarks>
/// <para>
/// <b>Shared deliberately.</b> The ingestion project writes these fields and the
/// API reads them, and a field name that exists twice as a string literal is a
/// field name that can differ in one of the two places. The symptom of that is
/// not an exception -- a <c>$vectorSearch</c> filtering on a field nobody writes
/// returns an empty result, which reads as "no candidates".
/// </para>
/// <para>
/// This is the only thing about the document that both halves need to agree on.
/// How a job is FETCHED and BUILT belongs to the ingestion project and is not
/// here; the API has no business holding a Greenhouse board parser.
/// </para>
/// </remarks>
public static class GreenhouseJobFields
{
    /// <summary>The board slug. Half of the upsert key.</summary>
    public const string BoardToken = "boardToken";

    /// <summary>Greenhouse's own job id. The other half of the upsert key.</summary>
    public const string GreenhouseJobId = "greenhouseJobId";

    public const string Title = "title";
    public const string Company = "company";
    public const string AbsoluteUrl = "absoluteUrl";
    public const string RequisitionId = "requisitionId";

    /// <summary>Free-text location as the board states it. A retrieval filter field.</summary>
    public const string Location = "location";

    /// <summary>Department names. Stored, never filtered on at ingest.</summary>
    /// <remarks>
    /// The whole board is kept, so narrowing by department later is a query
    /// rather than a re-ingest. A filter applied at write time is a decision
    /// that can only be revisited by re-fetching and re-embedding every board.
    /// </remarks>
    public const string Department = "department";

    public const string Office = "office";

    /// <summary>
    /// The extracted-fact sub-document, or null until it is extracted.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Deliberately the SAME contract the shared pool already stores</b>
    /// (<c>JobFacts</c>, and the <c>extracted.*</c> paths
    /// <c>PoolJobRepository</c> queries). Greenhouse is the first ATS source in
    /// a migration away from LinkedIn scraping, not a permanent second feed --
    /// so when this collection becomes the primary pool, <c>CandidateFilter</c>
    /// and the Evaluator must work against it with no change. They can only do
    /// that if the field names, the nesting and the five seniority bands are
    /// identical, so they are.
    /// </para>
    /// <para>
    /// <b>Null today, and that is safe rather than broken.</b> Every clause in
    /// <c>PoolJobRepository</c> is "matches OR is unstated", because the
    /// extraction is best-effort and a job with no facts must never become
    /// invisible to everyone. A Greenhouse row with <c>extracted: null</c>
    /// therefore passes the candidate filter rather than being hidden by it.
    /// </para>
    /// <para>
    /// What populates it is the extraction the pool already runs -- one batched
    /// call per new job, in the API, exactly once on entry. It is not wired
    /// here yet: this ingest makes no Claude calls at all. Wiring it is a
    /// self-contained step, and the shape below is what it writes.
    /// </para>
    /// </remarks>
    public const string Extracted = "extracted";

    /// <summary>Free-text location as the posting states it. <c>extracted.location</c>.</summary>
    public const string ExtractedLocation = "extracted.location";

    /// <summary>
    /// One of the five fixed bands, or null. <c>extracted.seniority</c>.
    /// </summary>
    /// <remarks>
    /// The bands are "entry level", "associate", "mid-senior level",
    /// "director", "executive" -- <c>CandidateFilter.Bands</c>, in that order,
    /// because it widens by one band either side using the index. A sixth value
    /// or a different spelling silently falls outside every band and the job
    /// stops matching anyone whose profile maps to a band.
    /// </remarks>
    public const string ExtractedSeniority = "extracted.seniority";

    /// <summary>Technologies stated as requirements. <c>extracted.must_have_tech</c>.</summary>
    public const string ExtractedMustHaveTech = "extracted.must_have_tech";

    public const string ExtractedAt = "extracted_at";

    /// <summary>
    /// How many times extraction has been tried for this job.
    /// </summary>
    /// <remarks>
    /// Mirrors the pool's counter, which increments whether or not the call
    /// succeeded -- so a posting the model consistently cannot read costs a
    /// bounded number of calls in its lifetime rather than one a day forever.
    /// </remarks>
    public const string ExtractAttempts = "extract_attempts";

    /// <summary>The cleaned, tag-stripped posting text.</summary>
    public const string Content = "content";

    /// <summary>SHA-256 of the title and cleaned body. Drives the re-embed skip.</summary>
    public const string ContentHash = "contentHash";

    /// <summary>
    /// The 1024-dimension document embedding.
    /// </summary>
    /// <remarks>
    /// Versioned in the name on purpose. A change of model or dimensions cannot
    /// reuse this field: the Atlas index is built for one dimension count, and
    /// a collection holding both would return whichever subset happens to match
    /// with no error anywhere. A new model is <c>embedding_v2</c>, a second
    /// index, and a backfill.
    /// </remarks>
    public const string Embedding = "embedding_v1";

    public const string EmbeddedAt = "embeddedAt";
    public const string FirstSeenAt = "firstSeenAt";
    public const string LastSeenAt = "lastSeenAt";
    public const string LastSeenRunId = "lastSeenRunId";

    /// <summary>
    /// When the board stopped listing this job. Null while it is open.
    /// </summary>
    /// <remarks>
    /// Nothing is ever deleted: a closed job keeps its text, its vector and its
    /// history and only acquires this field, which retrieval filters on. A job
    /// that reappears has it cleared.
    /// </remarks>
    public const string ClosedAt = "closedAt";

    public const string BoardUpdatedAt = "boardUpdatedAt";
    public const string FirstPublishedAt = "firstPublishedAt";

    /// <summary>Which ingest wrote this row. Constant for now; a second source would not be.</summary>
    public const string Source = "source";

    /// <summary>The collection these fields live in.</summary>
    /// <remarks>
    /// Entirely separate from <c>discovered_jobs</c>. Nothing merges the two
    /// sources and nothing in the Greenhouse path reads or writes the pool.
    /// </remarks>
    public const string Collection = "greenhouse_jobs";

    /// <summary>One row per company per day: pending, done or failed.</summary>
    public const string RunsCollection = "greenhouse_runs";
}
