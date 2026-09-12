using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Core.Repositories;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Core.Matching;

public interface IPoolRoleService
{
    Task SyncForProfileAsync(Guid userId, StructuredProfile profile, CancellationToken ct = default);
}

/// <summary>
/// Keeps the shared pool's role list in step with who is actually using the
/// product: a new CV can add the role it reveals, and a role nobody is under
/// any more drops out of the daily run.
/// </summary>
/// <remarks>
/// Runs once per profile save, off the request path. Never per scan and never
/// per ingest — the role list changes when people change, which is rare.
///
/// The cap lives in the scraper (config/roles.json `max_roles`), not here, and
/// that is deliberate: the cap protects the daily *search*, so it belongs where
/// the search is assembled. This service can record more roles than the cap
/// admits; the scraper takes the ones it will search and logs the rest. Putting
/// the cap here instead would mean refusing to record a role that a later
/// config change would have made room for.
/// </remarks>
public sealed class PoolRoleService : IPoolRoleService
{
    private readonly IPoolRoleRepository _roles;
    private readonly IClaudeClient _claude;
    private readonly ILogger<PoolRoleService> _logger;

    public PoolRoleService(IPoolRoleRepository roles, IClaudeClient claude, ILogger<PoolRoleService> logger)
    {
        _roles = roles;
        _claude = claude;
        _logger = logger;
    }

    public async Task SyncForProfileAsync(Guid userId, StructuredProfile profile, CancellationToken ct = default)
    {
        var titles = profile.Experience.Select(e => e.Title)
            .Where(t => !string.IsNullOrWhiteSpace(t)).Take(5).ToList();
        var skills = profile.Skills.SelectMany(g => g.Items)
            .Where(s => !string.IsNullOrWhiteSpace(s)).Take(30).ToList();

        // An emptied profile is a user who needs no role. Releasing rather than
        // leaving the old one standing is what makes "drop roles no active user
        // needs" true for the delete case as well as the switch case.
        if (titles.Count == 0 && skills.Count == 0 && string.IsNullOrWhiteSpace(profile.Summary))
        {
            var dropped = await _roles.ReleaseAsync(userId, ct);
            LogDropped(dropped, userId, "their profile no longer says what they do");
            return;
        }

        var existing = (await _roles.GetAllAsync(ct)).Select(r => r.Role).ToList();
        var result = await _claude.ClassifyRoleAsync(new RoleClassificationRequest
        {
            ExistingRoles = existing,
            Titles = titles,
            Summary = profile.Summary,
            Skills = skills,
        }, ct);

        if (string.IsNullOrWhiteSpace(result.Role))
        {
            // Too little to place them. Their previous role stays claimed: a
            // profile edit that happens to be vague should not silently stop a
            // role being searched.
            _logger.LogInformation("Pool role for {UserId}: unclassified, leaving the role list unchanged", userId);
            return;
        }

        var released = await _roles.ClaimAsync(userId, result.Role, ct);
        _logger.LogInformation(
            "Pool role for {UserId}: {Role} ({Source})", userId, result.Role,
            result.Existing ? "already searched" : "new to the daily run");
        LogDropped(released, userId, "they were the last user under it");
    }

    private void LogDropped(List<string> dropped, Guid userId, string because)
    {
        foreach (var role in dropped)
            _logger.LogInformation(
                "Pool role dropped from the daily run: {Role} — {Because} (user {UserId})", role, because, userId);
    }
}
