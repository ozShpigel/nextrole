using System.Text.Json;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// Long-running. Takes one company at a time and acks only after the write.
/// </summary>
/// <remarks>
/// <para>
/// <b>Long-running, not one-shot -- a deliberate choice.</b> A one-shot consumer
/// has to decide when the work is finished, and an empty queue does not mean
/// that: a message can be in flight, or delivered and unacked and about to be
/// redelivered, both of which look identical to "nothing left". The only honest
/// stop condition is the ledger -- zero pending rows for the day -- and a
/// consumer that polled it would hang forever the first time one company got
/// stuck. Staying up moves "are we done?" to something anyone can query
/// (<see cref="RunLedger.PendingAsync"/>) and out of the exit path of the
/// process that would have to be right about it.
/// </para>
/// <para>
/// The cost is honest and small: a container up all day for a once-daily burst,
/// holding one connection to a broker on the same host.
/// </para>
/// </remarks>
public sealed class CompanyConsumer
{
    private readonly IConnection _connection;
    private readonly CompanyHandler _handler;
    private readonly RunLedger _ledger;
    private readonly ILogger<CompanyConsumer> _log;

    public CompanyConsumer(
        IConnection connection, CompanyHandler handler, RunLedger ledger, ILogger<CompanyConsumer> log)
    {
        _connection = connection;
        _handler = handler;
        _ledger = ledger;
        _log = log;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        await using var channel = await _connection.CreateChannelAsync(
            // One at a time. A board is minutes of work and several billed
            // embedding calls; prefetching a second would only mean holding an
            // unacked message through the whole of the first, for no
            // throughput, and would double the work lost to a restart.
            new CreateChannelOptions(
                publisherConfirmationsEnabled: false,
                publisherConfirmationTrackingEnabled: false,
                consumerDispatchConcurrency: 1),
            ct);

        await Topology.DeclareAsync(channel, ct);
        await channel.BasicQosAsync(prefetchSize: 0, prefetchCount: 1, global: false, ct);

        var consumer = new AsyncEventingBasicConsumer(channel);
        consumer.ReceivedAsync += (_, delivery) => HandleAsync(channel, delivery, ct);

        await channel.BasicConsumeAsync(
            Topology.Queue,
            // NEVER autoAck. Acking on delivery means a consumer that dies
            // mid-board has already told the broker the work is done.
            autoAck: false,
            consumerTag: $"greenhouse-{Environment.MachineName}",
            noLocal: false,
            exclusive: false,
            arguments: null,
            consumer: consumer,
            cancellationToken: ct);

        _log.LogInformation("Consuming {Queue}; waiting for companies", Topology.Queue);

        try
        {
            await Task.Delay(Timeout.Infinite, ct);
        }
        catch (OperationCanceledException)
        {
            // SIGTERM. An in-flight company is abandoned WITHOUT an ack, so the
            // broker redelivers it and the next run redoes it -- idempotently,
            // because the hash skip means everything already written is free
            // the second time.
            _log.LogInformation("Shutting down; any in-flight company will be redelivered");
        }
    }

    private async Task HandleAsync(IChannel channel, BasicDeliverEventArgs delivery, CancellationToken ct)
    {
        CompanyMessage? message = null;

        try
        {
            message = JsonSerializer.Deserialize<CompanyMessage>(delivery.Body.Span);
        }
        catch (JsonException e)
        {
            _log.LogError(e, "Unparseable message; dead-lettering it");
        }

        if (message is null || string.IsNullOrWhiteSpace(message.BoardToken))
        {
            // Nothing to retry and nothing to record: we cannot even name the
            // company. Straight to the DLQ, where a human can look at it.
            await channel.BasicNackAsync(delivery.DeliveryTag, multiple: false, requeue: false, ct);
            return;
        }

        try
        {
            var result = await _handler.HandleCompanyAsync(message.BoardToken, ct);

            await _ledger.MarkDoneAsync(
                message.Day, message.BoardToken, result.ToCounts(), DateTime.UtcNow, ct);

            // ACK ONLY NOW. Everything above is durable: the jobs are upserted
            // per batch and the ledger row says done. Acking any earlier would
            // discard the message while the write could still fail, and the
            // company would be silently absent from the day.
            await channel.BasicAckAsync(delivery.DeliveryTag, multiple: false, ct);

            _log.LogInformation(
                "Board {Board}: done -- {Fetched} fetched, {Embedded} embedded, {Skipped} skipped, "
                + "{Closed} closed, {Tokens} tokens billed",
                message.BoardToken, result.Fetched, result.Embedded, result.Skipped,
                result.Closed, result.TokensBilled);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutdown, not failure. No ack and no nack: let the broker
            // redeliver it to whoever comes up next.
            _log.LogWarning("Board {Board}: interrupted by shutdown; leaving it unacked for redelivery",
                message.BoardToken);
        }
        catch (Exception e)
        {
            _log.LogError(e, "Board {Board}: failed", message.BoardToken);

            await _ledger.MarkFailedAsync(message.Day, message.BoardToken, e, DateTime.UtcNow, ct);

            // requeue: false -- to the DLQ, not back to the queue.
            //
            // A 429 or a 500 from one company is not retried here by design.
            // Requeueing sends it straight back to this same consumer, which is
            // a hot loop against a service that just asked us to slow down, and
            // it blocks every other company behind it. The retry is tomorrow's
            // timer; the ledger row says failed and carries the error, and the
            // company's stored jobs are untouched because a failed fetch never
            // reached the close diff.
            await channel.BasicNackAsync(delivery.DeliveryTag, multiple: false, requeue: false, ct);
        }
    }
}
