using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Fans one message out per board token, then exits. The daily timer's job.
/// </summary>
/// <remarks>
/// One-shot, like PoolIngest and the mailbot: it runs, it exits, and the exit
/// code is what systemd sees.
/// </remarks>
public sealed class CompanyPublisher
{
    private readonly IConnection _connection;
    private readonly RunLedger _ledger;
    private readonly ILogger<CompanyPublisher> _log;

    public CompanyPublisher(IConnection connection, RunLedger ledger, ILogger<CompanyPublisher> log)
    {
        _connection = connection;
        _ledger = ledger;
        _log = log;
    }

    /// <summary>
    /// Publish one message per company.
    /// </summary>
    /// <returns>How many were confirmed by the broker.</returns>
    /// <remarks>
    /// <para>
    /// <b>Exactly one message per token</b>, and the ledger row is written
    /// BEFORE the publish. That order is the point: a row written first and a
    /// publish that then fails leaves a pending row -- visible, and correct,
    /// because the company genuinely was not handled. The other order loses the
    /// company entirely if the process dies between the two, and nothing
    /// anywhere records that it was meant to run.
    /// </para>
    /// <para>
    /// Publisher confirms are on, so a "sent" message is one the broker has
    /// accepted and written, not one that reached a socket buffer.
    /// </para>
    /// </remarks>
    public async Task<int> PublishAsync(
        IReadOnlyList<string> boardTokens, string runId, CancellationToken ct)
    {
        var day = RunLedger.DayOf(DateTime.UtcNow);

        await using var channel = await _connection.CreateChannelAsync(
            new CreateChannelOptions(
                publisherConfirmationsEnabled: true,
                publisherConfirmationTrackingEnabled: true),
            ct);

        await Topology.DeclareAsync(channel, ct);

        var properties = new BasicProperties
        {
            // Survives a broker restart. A durable queue holding transient
            // messages loses them anyway, which is the worst of both.
            Persistent = true,
            ContentType = "application/json",
        };

        var published = 0;

        foreach (var token in boardTokens)
        {
            ct.ThrowIfCancellationRequested();

            await _ledger.MarkPendingAsync(day, token, runId, DateTime.UtcNow, ct);

            var body = JsonSerializer.SerializeToUtf8Bytes(
                new CompanyMessage { BoardToken = token, Day = day, RunId = runId });

            try
            {
                // Awaiting this awaits the broker's confirm.
                await channel.BasicPublishAsync(
                    Topology.Exchange, Topology.RoutingKey, mandatory: true, properties, body, ct);

                published++;
            }
            catch (Exception e)
            {
                // One company failing to publish must not cost the others their
                // run. The pending row stays pending, which is exactly what
                // happened.
                _log.LogError(e, "Could not publish board {Board}; its ledger row stays pending", token);
            }
        }

        _log.LogInformation(
            "Published {Published} of {Total} company message(s) for {Day} (run {RunId})",
            published, boardTokens.Count, day, runId);

        return published;
    }
}
