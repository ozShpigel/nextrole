using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Drops an index a release has replaced, on startup, once.
/// </summary>
/// <remarks>
/// <para>
/// For the old Greenhouse-only keys (docs/plans/key-migration.md, 2c):
/// <c>uniq_board_job</c> and <c>idx_board_open</c> on the jobs, and
/// <c>uniq_day_board</c> on the run ledger. Each would refuse the first
/// non-Greenhouse rows -- two Workday postings on one board both have no
/// <c>greenhouseJobId</c> -- so they must be gone before such a row exists, in
/// every database the ingest runs against, which is why this is code and not
/// a command run by hand on the box.
/// </para>
/// <para>
/// <b>Never throws.</b> A failed drop leaves an index that only matters once a
/// second source is added, and then it fails loudly (a duplicate-key error);
/// refusing to start the Greenhouse ingest over it would be the worse outage.
/// The publisher and the consumer both run this, so one of them finding the
/// index already gone is the expected case, not an error.
/// </para>
/// </remarks>
public static class LegacyIndexes
{
    /// <summary>Mongo's IndexNotFound: the other process dropped it first.</summary>
    private const int IndexNotFound = 27;

    public static async Task DropIfPresentAsync(
        IMongoCollection<BsonDocument> collection, string name, ILogger log, CancellationToken ct)
    {
        try
        {
            var existing = await (await collection.Indexes.ListAsync(ct)).ToListAsync(ct);
            if (!existing.Any(i => i.TryGetValue("name", out var n) && n == name)) return;

            await collection.Indexes.DropOneAsync(name, ct);
            log.LogInformation("Dropped the replaced index {Index} on {Collection}",
                name, collection.CollectionNamespace.CollectionName);
        }
        catch (MongoCommandException e) when (e.Code == IndexNotFound)
        {
            // Dropped by the other process between our list and our drop.
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "Could not drop the replaced index {Index} on {Collection}; "
                + "it must be gone before a second source is added",
                name, collection.CollectionNamespace.CollectionName);
        }
    }
}
