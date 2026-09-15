using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

// One document per user, keyed by _id = userId. The id is the scope for reads
// and writes about a known user; FindByGoogleSubAsync is the single deliberate
// exception, because a callback knows the Google account before it knows the
// user (see GoogleIdentity for the full note).
public sealed class GoogleIdentityRepository : IGoogleIdentityRepository
{
    private readonly IMongoCollection<GoogleIdentity> _collection;

    public GoogleIdentityRepository(IMongoCollection<GoogleIdentity> collection) => _collection = collection;

    public async Task<GoogleIdentity?> FindByGoogleSubAsync(string googleSub, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(googleSub)) return null;
        return await _collection.Find(g => g.GoogleSub == googleSub).FirstOrDefaultAsync(ct);
    }

    public async Task<GoogleIdentity?> GetAsync(Guid userId, CancellationToken ct = default)
    {
        return await _collection.Find(g => g.Id == userId).FirstOrDefaultAsync(ct);
    }

    public async Task<bool> TryLinkAsync(GoogleIdentity identity, CancellationToken ct = default)
    {
        try
        {
            await _collection.InsertOneAsync(identity, cancellationToken: ct);
            return true;
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Either this userId is already linked (_id) or this Google account
            // is already linked to somebody else (GoogleSub). Both mean "do not
            // link"; neither is an error the caller can fix by retrying.
            return false;
        }
    }

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        // Unique: one Google account can own at most one NextRole user. Without
        // it, TryLinkAsync's duplicate-key guard only covers the _id half and a
        // second user could link the same Google account.
        var keys = Builders<GoogleIdentity>.IndexKeys.Ascending(g => g.GoogleSub);
        await _collection.Indexes.CreateOneAsync(
            new CreateIndexModel<GoogleIdentity>(
                keys,
                new CreateIndexOptions { Unique = true, Name = "uniq_googlesub" }),
            cancellationToken: ct);
    }
}
