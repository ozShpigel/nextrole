using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// The posting dates of new postings found too old -- so the next run skips
/// them from the listing instead of reading their detail again to learn it.
/// </summary>
/// <remarks>
/// <para>
/// A posting the pre-read filter skips is never stored, so every run sees it as
/// new. For a source whose listing carries a date (Greenhouse) that costs
/// nothing. For Workday it cost a detail request each, every day: 145 of
/// NVIDIA's ~460 on 2026-09-28, about a third of its run, to learn again that
/// the same postings are older than Matches shows. Postings only get older.
/// </para>
/// <para>
/// <b>The date, not the decision.</b> Stage 1 applies today's age rule to the
/// remembered date, so widening the window (it has moved: four months, then
/// three) brings those postings back by itself.
/// </para>
/// <para>
/// <b>Kept 14 days</b> (a TTL index on <c>checkedAt</c>), so a company that
/// re-dates a posting under the same id is stale for two weeks at most; the
/// cost is re-reading each one's detail once a fortnight instead of daily.
/// </para>
/// <para>
/// Its own collection: a skipped posting is not a job, and nothing that reads
/// the pool -- retrieval, Matches, the close diff -- must ever see one.
/// </para>
/// </remarks>
public interface ITooOldMemory
{
    /// <summary>Remembered posting dates for this board, by the board's own id.</summary>
    Task<IReadOnlyDictionary<string, DateTime>> RememberedAsync(string boardKey, CancellationToken ct);

    /// <summary>Remember (or refresh) these postings' dates.</summary>
    Task RememberAsync(string boardKey, IReadOnlyCollection<(string Id, DateTime PostedAt)> postings,
        DateTime now, CancellationToken ct);
}

/// <inheritdoc cref="ITooOldMemory"/>
public sealed class TooOldMemory(IMongoCollection<BsonDocument> memory) : ITooOldMemory
{
    /// <summary>
    /// The ingest's, not a source's: only Workday uses it (a Greenhouse listing
    /// carries its own dates). The older ingest collections still say
    /// <c>greenhouse_*</c> from when the ingest was the Greenhouse source.
    /// </summary>
    public const string CollectionName = "ingest_too_old";

    /// <summary>How long a remembered date is trusted before the detail is read again.</summary>
    public static readonly TimeSpan KeptFor = TimeSpan.FromDays(14);

    public async Task<IReadOnlyDictionary<string, DateTime>> RememberedAsync(string boardKey, CancellationToken ct)
    {
        var docs = await memory.Find(Builders<BsonDocument>.Filter.Eq("boardKey", boardKey)).ToListAsync(ct);
        return docs
            .Where(d => d.TryGetValue("sourceJobId", out var id) && id.IsString
                        && d.TryGetValue("postedAt", out var at) && at.IsValidDateTime)
            .ToDictionary(d => d["sourceJobId"].AsString, d => d["postedAt"].ToUniversalTime(), StringComparer.Ordinal);
    }

    public async Task RememberAsync(string boardKey, IReadOnlyCollection<(string Id, DateTime PostedAt)> postings,
        DateTime now, CancellationToken ct)
    {
        if (postings.Count == 0) return;

        var writes = postings.Select(p => new ReplaceOneModel<BsonDocument>(
            Builders<BsonDocument>.Filter.Eq("_id", $"{boardKey}|{p.Id}"),
            new BsonDocument
            {
                { "_id", $"{boardKey}|{p.Id}" },
                { "boardKey", boardKey },
                { "sourceJobId", p.Id },
                { "postedAt", p.PostedAt },
                { "checkedAt", now },
            }) { IsUpsert = true });

        await memory.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
    }

    public Task EnsureIndexesAsync(CancellationToken ct) =>
        memory.Indexes.CreateManyAsync(
        [
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("boardKey"),
                new CreateIndexOptions { Name = "idx_boardkey" }),
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("checkedAt"),
                new CreateIndexOptions { Name = "ttl_checked", ExpireAfter = KeptFor }),
        ], ct);
}
