using Mailbot.Models;

namespace Mailbot.Services;

public interface ITrackerApiClient
{
    /// <summary>Returns null if the Tracker API could not be reached (timeout, network, etc.). Empty list means success with no active applications.</summary>
    Task<List<TrackerApplication>?> GetActiveApplicationsAsync(CancellationToken ct = default);
    /// <summary>All applications including terminal ones (Rejected/Withdrawn/Accepted). Used by re-sync, which may target any application. Null on transport failure.</summary>
    Task<List<TrackerApplication>?> GetAllApplicationsAsync(CancellationToken ct = default);
    /// <summary>Reads the instance's demoMode flag from GET /api/config. Null if unreachable/unparseable.</summary>
    Task<bool?> GetDemoModeAsync(CancellationToken ct = default);
    Task<bool> UpdateApplicationStatusAsync(Guid appId, string newStatus, string? note = null, CancellationToken ct = default);
    Task<bool> AddInterviewAsync(Guid appId, AddInterviewRequest interview, CancellationToken ct = default);
    /// <summary>Persists a parsed email (upserted server-side by GmailMessageId) so it shows on the client's Messages tab.</summary>
    Task<bool> AddMessageAsync(AddMessageRequest message, CancellationToken ct = default);
}

public sealed record AddInterviewRequest
{
    public required DateTime ScheduledAt { get; init; }
    public DateTime? EndsAt { get; init; }
    public required string Type { get; init; }
    public string? Interviewer { get; init; }
    public string? Topics { get; init; }
    public string? Notes { get; init; }
}

public sealed record AddMessageRequest
{
    public required string GmailMessageId { get; init; }
    // Null when the parser recognized the email but MatchApplication couldn't
    // tie it to a tracked application — still worth persisting for visibility.
    public Guid? ApplicationId { get; init; }
    public required string Company { get; init; }
    public string? JobTitle { get; init; }
    public required string Subject { get; init; }
    public required string From { get; init; }
    public required string UpdateType { get; init; }
    public required string Snippet { get; init; }
    public DateTime ReceivedAt { get; init; }
}
