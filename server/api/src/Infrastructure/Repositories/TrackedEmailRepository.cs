using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class TrackedEmailRepository : ITrackedEmailRepository
{
    private readonly IMongoCollection<TrackedEmail> _emails;

    public TrackedEmailRepository(IMongoCollection<TrackedEmail> emails) => _emails = emails;

    public async Task<TrackedEmail> UpsertAsync(TrackedEmail email, CancellationToken ct = default)
    {
        // GmailMessageId (not the Mongo _id) is the real identity here — keep the
        // existing row's _id on a re-sync/overlap hit instead of letting the
        // caller's freshly-generated Guid collide with the immutable-_id rule.
        var existing = await _emails.Find(e => e.GmailMessageId == email.GmailMessageId).FirstOrDefaultAsync(ct);
        var doc = existing is null ? email : email with { Id = existing.Id };
        await _emails.ReplaceOneAsync(
            e => e.GmailMessageId == email.GmailMessageId, doc,
            new ReplaceOptions { IsUpsert = true }, ct);
        return doc;
    }

    public async Task<List<TrackedEmail>> GetAllAsync(CancellationToken ct = default)
    {
        return await _emails.Find(FilterDefinition<TrackedEmail>.Empty)
            .SortByDescending(e => e.ReceivedAt)
            .ToListAsync(ct);
    }
}
