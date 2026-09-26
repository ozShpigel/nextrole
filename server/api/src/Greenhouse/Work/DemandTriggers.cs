using ApplicationTracker.Core.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>What one pass of the trigger loop does with the open requests.</summary>
public enum TriggerAction
{
    /// <summary>No pending requests.</summary>
    Nothing,
    /// <summary>The filter is not on: nothing was skipped, so there is nothing to collect. Close them.</summary>
    Close,
    /// <summary>A triggered run started too recently: leave them pending, the next pass picks them up.</summary>
    Wait,
    /// <summary>Claim every pending request into one run and fan out every board with live reads.</summary>
    Run,
}

/// <summary>
/// Acts on <see cref="DemandTrigger"/> requests: a profile save brought a
/// function or location nobody had, so the postings that user wants were
/// skipped by every earlier run. Runs every board now, with live reads,
/// instead of leaving them a day for the next scheduled run.
/// </summary>
/// <remarks>
/// <para>
/// <b>Cheap by construction.</b> Fetching a board costs nothing, the hash skip
/// makes every stored posting free, and the pre-read filter still skips what
/// nobody wants -- so a triggered run pays only for the postings the new
/// function or location just made wanted. Live reads cost twice a batch, on
/// those few dozen postings, once per new value.
/// </para>
/// <para>
/// <b>Bounded.</b> Cookies are free, so anyone can upload CVs with made-up
/// places. A value counts as new only once (until its last user leaves), and
/// at most one triggered run starts per <see cref="Cooldown"/>: requests
/// arriving meanwhile wait and share the next run.
/// </para>
/// </remarks>
public sealed class DemandTriggers
{
    /// <summary>How often the consumer looks for requests.</summary>
    public static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    /// <summary>At most one triggered run per this long.</summary>
    public static readonly TimeSpan Cooldown = TimeSpan.FromMinutes(10);

    /// <summary>A claimed request whose run never finished is closed after this.</summary>
    public static readonly TimeSpan RunTimeout = TimeSpan.FromHours(1);

    private readonly IMongoCollection<DemandTrigger> _triggers;
    private readonly IMongoCollection<ConsumerHeartbeat> _heartbeat;
    private readonly IMongoCollection<BsonDocument> _runs;
    private readonly Func<string, CancellationToken, Task<int>> _publishLive;
    private readonly PrefilterMode _mode;
    private readonly ILogger<DemandTriggers> _log;

    /// <param name="publishLive">Fans out every board under this run id with live reads.</param>
    public DemandTriggers(
        IMongoDatabase database, Func<string, CancellationToken, Task<int>> publishLive,
        PrefilterMode mode, ILogger<DemandTriggers> log)
    {
        _triggers = database.GetCollection<DemandTrigger>(DemandTrigger.CollectionName);
        _heartbeat = database.GetCollection<ConsumerHeartbeat>(ConsumerHeartbeat.CollectionName);
        _runs = database.GetCollection<BsonDocument>(Core.Greenhouse.GreenhouseJobFields.RunsCollection);
        _publishLive = publishLive;
        _mode = mode;
        _log = log;
    }

    /// <summary>The decision, apart from the database, so it can be tested as it is.</summary>
    public static TriggerAction Plan(
        int pending, DateTime? lastClaimedAt, DateTime now, PrefilterMode mode, TimeSpan cooldown)
    {
        if (pending == 0) return TriggerAction.Nothing;
        if (mode != PrefilterMode.On) return TriggerAction.Close;
        if (lastClaimedAt is { } last && now - last < cooldown) return TriggerAction.Wait;
        return TriggerAction.Run;
    }

    /// <summary>One pass: heartbeat, close finished runs, then act on pending requests.</summary>
    public async Task TickAsync(DateTime now, CancellationToken ct)
    {
        // The API tells a user roles are being collected only while this is
        // fresh and says On -- a consumer that is down, or in log mode, must
        // never leave "collecting" on screen.
        await _heartbeat.ReplaceOneAsync(
            h => h.Id == ConsumerHeartbeat.SingletonId,
            new ConsumerHeartbeat { Prefilter = _mode.ToString(), SeenAt = now },
            new ReplaceOptions { IsUpsert = true }, ct);

        await CloseFinishedAsync(now, ct);

        var pending = await _triggers.Find(t => t.RunId == null && t.DoneAt == null).ToListAsync(ct);
        var last = await _triggers.Find(t => t.ClaimedAt != null)
            .SortByDescending(t => t.ClaimedAt).Limit(1).FirstOrDefaultAsync(ct);

        switch (Plan(pending.Count, last?.ClaimedAt, now, _mode, Cooldown))
        {
            case TriggerAction.Close:
                await _triggers.UpdateManyAsync(
                    t => t.RunId == null && t.DoneAt == null,
                    Builders<DemandTrigger>.Update.Set(t => t.DoneAt, now)
                        .Set(t => t.Outcome, $"not run: pre-read filter is {_mode}, nothing was skipped"),
                    cancellationToken: ct);
                _log.LogInformation("Closed {Count} ingest request(s) without a run: the pre-read filter is {Mode}",
                    pending.Count, _mode);
                break;

            case TriggerAction.Wait:
                // Debug: this pass repeats every PollInterval through the cooldown.
                _log.LogDebug(
                    "{Count} ingest request(s) waiting: a triggered run started at {Last:HH:mm:ss}, next allowed after {Next:HH:mm:ss}",
                    pending.Count, last!.ClaimedAt, last.ClaimedAt!.Value + Cooldown);
                break;

            case TriggerAction.Run:
                var runId = "trigger-" + Guid.NewGuid().ToString("N")[..12];
                var ids = pending.Select(t => t.Id).ToList();
                // Claimed before publishing: a crash between the two leaves a
                // request that times out closed, never one that runs twice.
                await _triggers.UpdateManyAsync(
                    Builders<DemandTrigger>.Filter.In(t => t.Id, ids),
                    Builders<DemandTrigger>.Update.Set(t => t.RunId, runId).Set(t => t.ClaimedAt, now),
                    cancellationToken: ct);
                var published = await _publishLive(runId, ct);
                if (published == 0)
                {
                    // No ledger rows would read as "nothing pending", i.e. done.
                    await _triggers.UpdateManyAsync(
                        Builders<DemandTrigger>.Filter.In(t => t.Id, ids),
                        Builders<DemandTrigger>.Update.Set(t => t.DoneAt, now)
                            .Set(t => t.Outcome, "not run: no board could be published"),
                        cancellationToken: ct);
                    _log.LogError("Triggered run {RunId}: no board could be published; {Count} request(s) closed",
                        runId, pending.Count);
                    break;
                }
                _log.LogInformation(
                    "Triggered run {RunId} for {Count} request(s) ({Values}): {Published} board(s) published, live reads",
                    runId, pending.Count, string.Join(", ", pending.SelectMany(t => t.Values).Distinct()), published);
                break;
        }
    }

    /// <summary>
    /// Close claimed requests whose run has no board left pending -- the
    /// postings are read and stored, so Matches can refresh.
    /// </summary>
    private async Task CloseFinishedAsync(DateTime now, CancellationToken ct)
    {
        var running = await _triggers.Find(t => t.RunId != null && t.DoneAt == null).ToListAsync(ct);

        foreach (var run in running.GroupBy(t => t.RunId!))
        {
            var claimedAt = run.Min(t => t.ClaimedAt) ?? now;
            // The ledger keeps one row per board per day, keyed by its latest
            // dispatch: a later run the same day takes the row over, which
            // also reads as "nothing of ours pending" -- and is equally done.
            var stillPending = await _runs.CountDocumentsAsync(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Eq("runId", run.Key),
                    Builders<BsonDocument>.Filter.Eq("status", "pending")),
                cancellationToken: ct);

            string? outcome = stillPending == 0 ? "done"
                : now - claimedAt > RunTimeout ? $"timed out with {stillPending} board(s) pending"
                : null;
            if (outcome is null) continue;

            await _triggers.UpdateManyAsync(
                t => t.RunId == run.Key && t.DoneAt == null,
                Builders<DemandTrigger>.Update.Set(t => t.DoneAt, now).Set(t => t.Outcome, outcome),
                cancellationToken: ct);
            _log.LogInformation("Triggered run {RunId}: {Outcome} after {Seconds:0}s",
                run.Key, outcome, (now - claimedAt).TotalSeconds);
        }
    }
}
