using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class TrackedEmailRepository : ITrackedEmailRepository
{
    private readonly UserScopedCollection<TrackedEmail> _emails;

    public TrackedEmailRepository(UserScopedCollection<TrackedEmail> emails) => _emails = emails;

    public async Task<TrackedEmail> UpsertAsync(Guid userId, TrackedEmail email, CancellationToken ct = default)
    {
        var owned = email with { UserId = userId };
        // (UserId, GmailMessageId) — not the Mongo _id — is the real identity
        // here: keep the existing row _id on a re-sync/overlap hit instead of
        // letting the caller freshly-generated Guid collide with the
        // immutable-_id rule.
        var existing = await _emails.Find(userId, e => e.GmailMessageId == owned.GmailMessageId).FirstOrDefaultAsync(ct);
        // Mailbot never sets IsRead — carry the existing row value forward so a
        // re-sync/overlap re-processing an already-read email does not flip it
        // back to unread.
        var doc = existing is null ? owned : owned with { Id = existing.Id, IsRead = existing.IsRead };
        await _emails.ReplaceOneAsync(
            userId, e => e.GmailMessageId == owned.GmailMessageId, doc,
            new ReplaceOptions { IsUpsert = true }, ct);
        return doc;
    }

    public async Task<List<TrackedEmail>> GetAllAsync(Guid userId, CancellationToken ct = default)
    {
        return await _emails.FindAll(userId)
            .SortByDescending(e => e.ReceivedAt)
            .ToListAsync(ct);
    }

    public async Task<HashSet<string>> GetGmailMessageIdsAsync(Guid userId, CancellationToken ct = default)
    {
        var ids = await _emails.FindAll(userId)
            .Project(e => e.GmailMessageId)
            .ToListAsync(ct);
        return ids.ToHashSet();
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        await _emails.DeleteOneAsync(userId, e => e.Id == id, ct);
    }

    public async Task MarkReadAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        await _emails.UpdateOneAsync(
            userId,
            e => e.Id == id,
            Builders<TrackedEmail>.Update.Set(e => e.IsRead, true),
            ct: ct);
    }
}
