using ApplicationTracker.Core.Greenhouse;
namespace ApplicationTracker.Greenhouse;

/// <summary>
/// The Greenhouse collection's write side, as <see cref="CompanyHandler"/> uses it.
/// </summary>
/// <remarks>
/// An interface so the handler's own logic -- the hash skip, batch alignment,
/// per-batch writing, and the fact that a failed fetch never reaches the close
/// diff -- can be tested without a database. The Mongo semantics themselves
/// (upsert on the unique key, clearing closedAt on reopen) are verified against
/// a real collection in <c>JobStoreIntegrationTests</c>, because a fake that
/// models them is only evidence about the fake.
/// </remarks>
public interface IJobStore
{
    Task<Dictionary<long, string>> StoredHashesAsync(string boardToken, CancellationToken ct);

    Task<(long Upserted, long Modified)> UpsertBatchAsync(
        IReadOnlyList<(GreenhouseJob Job, float[] Vector)> batch, string runId, DateTime now,
        CancellationToken ct);

    Task<long> TouchAsync(
        string boardToken, IReadOnlyCollection<long> ids, string runId, DateTime now, CancellationToken ct);

    /// <summary>
    /// Store the ingest-time AI reads for jobs that have just entered.
    /// </summary>
    /// <remarks>
    /// Both are user-independent, so they are computed once here rather than
    /// once per user. Either may be absent for a given job -- a failed chunk
    /// contributes nothing and is retried on a later run.
    /// </remarks>
    Task<long> SaveIngestAiAsync(
        string boardToken,
        IReadOnlyDictionary<long, MongoDB.Bson.BsonDocument> facts,
        IReadOnlyDictionary<long, MongoDB.Bson.BsonDocument> parsed,
        string? parseVersion,
        DateTime now,
        CancellationToken ct,
        bool countAttempt = true);

    /// <summary>Mark postings as being read by an open batch (<see cref="IngestBatcher"/>).</summary>
    Task MarkAiPendingAsync(
        string boardToken, IReadOnlyCollection<long> ids, string kind, string batchId, CancellationToken ct);

    /// <summary>Clear the markers THIS batch set; a newer batch's marker is left alone.</summary>
    Task ClearAiPendingAsync(
        string boardToken, IReadOnlyCollection<long> ids, string kind, string batchId, CancellationToken ct);

    /// <summary>The stored text of these postings, for verifying a batch parse against it.</summary>
    Task<IReadOnlyList<StoredJobContent>> StoredContentForAsync(
        string boardToken, IReadOnlyCollection<long> ids, CancellationToken ct);

    /// <summary>
    /// Open postings that have never had the ingest AI reads run over them.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The hash skip cannot reach these.</b> The AI passes run only over
    /// jobs whose content CHANGED, which is right for a posting that already
    /// has facts — but it makes "never attempted" indistinguishable from
    /// "attempted, unchanged". A run where <c>Api:BaseUrl</c> was unset, or the
    /// API was down, or the chunks failed, therefore leaves postings factless
    /// <i>permanently</i>: nothing re-selects them until the company edits the
    /// text on their board.
    /// </para>
    /// <para>
    /// That is not hypothetical. The production consumer was found running with
    /// no <c>Api__BaseUrl</c> in its environment — it was absent from
    /// <c>docker-compose.yml</c>'s <c>greenhouse-consumer</c> at the same time,
    /// so a local run rehearsed the same gap rather than exposing it (both are
    /// fixed; the box reads <c>deploy/.env.greenhouse</c>, which CI does not
    /// sync). Every posting it stored has an empty <c>extracted</c> and no
    /// <c>parsed</c> —
    /// which silently disables the server-side <c>stackedGaps</c> check, drops
    /// the location and seniority filters back to raw board text, and makes
    /// every per-user scan pay for an inline Analyst parse.
    /// </para>
    /// <para>
    /// <c>extract_attempts: 0</c> is the signal, and it is deliberately the one
    /// the initial write sets (see <c>GreenhouseJob.InitialExtractionFields</c>).
    /// It also bounds the sweep on its own: a posting the model genuinely
    /// cannot read has its attempts incremented whether or not facts came back,
    /// so it leaves this set after one try rather than being retried forever.
    /// </para>
    /// <para>
    /// Returns the stored content needed to re-run the reads, and nothing else.
    /// The backfill must NOT touch <c>contentHash</c> or <c>embedding_v1</c> —
    /// the vectors are valid and already paid for, and re-embedding to fix a
    /// missing parse would spend money for no reason.
    /// </para>
    /// </remarks>
    Task<IReadOnlyList<StoredJobContent>> NeedingIngestAiAsync(
        string boardToken, int limit, CancellationToken ct);

    /// <summary>
    /// Open postings whose facts were read before requirement groups, or job
    /// functions, existed.
    /// </summary>
    /// <remarks>
    /// Their <c>must_have_tech</c> is a flat list, so "Go, Ruby, or Python" is
    /// stored as three requirements and scored as three gaps against a Python
    /// candidate. Only the FACTS are re-read: the parse, the content hash and
    /// the vector are all still valid, and re-running the parse would pay
    /// roughly five times the facts cost for an identical result.
    /// </remarks>
    Task<IReadOnlyList<StoredJobContent>> NeedingFactsReReadAsync(
        string boardToken, int limit, CancellationToken ct);

    /// <summary>
    /// Set this board's logo on every row it has, open or closed.
    /// </summary>
    /// <remarks>
    /// Per board, not per posting, and not part of the upsert: the hash skip
    /// means an unchanged posting is never rewritten, so a logo carried on the
    /// upsert would reach only postings that changed after it was configured.
    /// Null clears it, so removing a domain from the config removes the logo.
    /// </remarks>
    /// <summary>
    /// What Claude read for these postings -- <c>extracted.functions</c> and
    /// <c>extracted.location</c> -- by job id. For the pre-read filter's checks.
    /// </summary>
    Task<Dictionary<long, StoredFacts>> StoredFactsAsync(
        string boardToken, IReadOnlyCollection<long> ids, CancellationToken ct);

    Task<long> StampCompanyLogoAsync(string boardToken, string? logoUrl, CancellationToken ct);

    Task<long> CloseMissingAsync(
        string boardToken, IReadOnlyCollection<long> seenIds, int emptyResponseGuardThreshold,
        DateTime now, CancellationToken ct);
}

/// <summary>
/// A stored posting's identity and text — the inputs the ingest AI reads need,
/// with nothing else carried along.
/// </summary>
/// <param name="Functions">extracted.functions; empty when none stored.</param>
/// <param name="Location">extracted.location; null when none stored.</param>
public sealed record StoredFacts(string[] Functions, string? Location);

public sealed record StoredJobContent(
    long GreenhouseJobId,
    string Title,
    string Company,
    string? Location,
    string Content);
