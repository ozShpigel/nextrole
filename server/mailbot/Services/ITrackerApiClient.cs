using Mailbot.Models;

namespace Mailbot.Services;

public interface ITrackerApiClient
{
    /// <summary>Returns null if the Tracker API could not be reached (timeout, network, etc.). Empty list means success with no active applications.</summary>
    Task<List<TrackerApplication>?> GetActiveApplicationsAsync(CancellationToken ct = default);
    Task<bool> UpdateApplicationStatusAsync(Guid appId, string newStatus, string? note = null, CancellationToken ct = default);
    Task<bool> AddInterviewAsync(Guid appId, AddInterviewRequest interview, CancellationToken ct = default);
}

public sealed record AddInterviewRequest
{
    public required DateTime ScheduledAt { get; init; }
    public required string Type { get; init; }
    public string? Interviewer { get; init; }
    public string? Topics { get; init; }
    public string? Notes { get; init; }
}
