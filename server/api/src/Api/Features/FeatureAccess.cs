using Microsoft.Extensions.Options;

namespace ApplicationTracker.Api.Features;

/// <summary>Whether a user may use a gated feature.</summary>
/// <remarks>
/// Async, although the config-backed answer is not: the seam for a
/// subscription-backed implementation later, without touching the callers.
/// </remarks>
public interface IFeatureAccess
{
    Task<bool> CanUseAsync(string feature, Guid userId);
}

/// <summary>From configuration: a free feature is open to everyone, any other only to its allowlist.</summary>
public sealed class ConfigFeatureAccess(IOptionsMonitor<FeatureOptions> options) : IFeatureAccess
{
    public Task<bool> CanUseAsync(string feature, Guid userId)
    {
        var o = options.CurrentValue;

        // TryGetValue, never an indexer or a default: FeatureStatus's default
        // is Free, so a feature missing from config must not read as free.
        var free = o.Status.TryGetValue(feature, out var status) && status == FeatureStatus.Free;
        var allowed = o.AllowedUsers.TryGetValue(feature, out var users) && users.Contains(userId);
        return Task.FromResult(free || allowed);
    }
}
