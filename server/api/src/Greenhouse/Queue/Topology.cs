using System.Text.Json.Serialization;
using RabbitMQ.Client;

namespace ApplicationTracker.Greenhouse;

/// <summary>One company to handle. The entire message.</summary>
/// <remarks>
/// A board token and enough to attribute the work, nothing more. The consumer
/// re-fetches the board itself, so a message that sits in the queue for an hour
/// is not stale -- it never carried any board data to go stale.
/// </remarks>
public sealed record CompanyMessage
{
    [JsonPropertyName("boardToken")] public required string BoardToken { get; init; }

    /// <summary>The ledger day this dispatch belongs to, so the consumer resolves the right row.</summary>
    [JsonPropertyName("day")] public required string Day { get; init; }

    [JsonPropertyName("runId")] public required string RunId { get; init; }
}

/// <summary>
/// The exchange, queue and dead-letter queue, declared identically by both ends.
/// </summary>
/// <remarks>
/// <para>
/// Both the publisher and the consumer declare the whole topology on startup.
/// Declaration is idempotent, and it means neither process depends on the other
/// having run first -- a consumer started against an empty broker is ready, and
/// a publisher that runs before any consumer exists still has somewhere durable
/// to put its messages.
/// </para>
/// <para>
/// Everything durable: the exchange, the queues, and the messages themselves.
/// A broker restart between the timer firing and the consumer finishing must
/// not lose a company, because nothing would notice -- the day would simply
/// come out smaller, and only the ledger's pending row would say so.
/// </para>
/// </remarks>
public static class Topology
{
    public const string Exchange = "greenhouse";
    public const string Queue = "greenhouse.companies";
    public const string RoutingKey = "company";

    public const string DeadLetterExchange = "greenhouse.dlx";
    public const string DeadLetterQueue = "greenhouse.companies.dlq";
    public const string DeadLetterRoutingKey = "company.failed";

    public static async Task DeclareAsync(IChannel channel, CancellationToken ct)
    {
        // Dead-letter side first: the main queue names it in its arguments, and
        // a queue pointing at an exchange that does not exist yet drops what it
        // rejects rather than routing it.
        await channel.ExchangeDeclareAsync(
            DeadLetterExchange, ExchangeType.Direct, durable: true, autoDelete: false,
            cancellationToken: ct);

        await channel.QueueDeclareAsync(
            DeadLetterQueue, durable: true, exclusive: false, autoDelete: false,
            cancellationToken: ct);

        await channel.QueueBindAsync(
            DeadLetterQueue, DeadLetterExchange, DeadLetterRoutingKey, cancellationToken: ct);

        await channel.ExchangeDeclareAsync(
            Exchange, ExchangeType.Direct, durable: true, autoDelete: false, cancellationToken: ct);

        await channel.QueueDeclareAsync(
            Queue, durable: true, exclusive: false, autoDelete: false,
            arguments: new Dictionary<string, object?>
            {
                // A rejected message goes here rather than back to the queue.
                // Requeueing a poison message is an infinite loop that looks
                // like a busy consumer.
                { "x-dead-letter-exchange", DeadLetterExchange },
                { "x-dead-letter-routing-key", DeadLetterRoutingKey },
            },
            cancellationToken: ct);

        await channel.QueueBindAsync(Queue, Exchange, RoutingKey, cancellationToken: ct);
    }
}
