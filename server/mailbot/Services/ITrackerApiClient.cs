using Mailbot.Models;

namespace Mailbot.Services;

public interface ITrackerApiClient
{
    /// <summary>Returns null if the Tracker API could not be reached (timeout, network, etc.). Empty list means success with no active applications.</summary>
    Task<List<TrackerApplication>?> GetActiveApplicationsAsync(CancellationToken ct = default);
    /// <summary>All applications including terminal ones (Rejected/Withdrawn/Accepted). Used by re-sync, which may target any application. Null on transport failure.</summary>
    Task<List<TrackerApplication>?> GetAllApplicationsAsync(CancellationToken ct = default);
    /// <summary>Reads GET /api/config. Null if unreachable/unparseable.</summary>
    Task<TrackerConfig?> GetConfigAsync(CancellationToken ct = default);
    /// <summary>
    /// Reads GET /api/auth/me, which answers as whoever this client's identity resolves to.
    /// This is how the mailbot checks that its session token reached the RIGHT account rather
    /// than merely reaching the API: a missing or dead token still returns 200, describing a
    /// fresh anonymous user with no applications. Null on transport failure.
    /// </summary>
    Task<TrackerIdentity?> GetMeAsync(CancellationToken ct = default);
    Task<bool> UpdateApplicationStatusAsync(Guid appId, string newStatus, string? note = null, CancellationToken ct = default);
    Task<bool> AddInterviewAsync(Guid appId, AddInterviewRequest interview, CancellationToken ct = default);
    /// <summary>Persists a parsed email (upserted server-side by GmailMessageId) so it shows on the client's Messages tab.</summary>
    Task<bool> AddMessageAsync(AddMessageRequest message, CancellationToken ct = default);
    /// <summary>GmailMessageIds already persisted from a prior run — lets the daily sync skip a Claude call on mail it has already parsed. Null on transport failure (caller should treat as "skip nothing" rather than block the run).</summary>
    Task<HashSet<string>?> GetKnownGmailMessageIdsAsync(CancellationToken ct = default);
}

/// <param name="IdentityMode">"Fixed" or "Cookie". Null on an API too old to report it —
/// treated as Cookie, because assuming Fixed is the assumption that fails silently.</param>
public sealed record TrackerConfig(bool DemoMode, string? IdentityMode);

/// <param name="SignedIn">True when the resolved user is linked to a Google account.</param>
public sealed record TrackerIdentity(bool SignedIn, string? Email, bool Available);

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
