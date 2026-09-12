using ApplicationTracker.Core.Identity;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

/// <summary>
/// A Mongo collection that cannot be queried without a userId.
/// </summary>
/// <remarks>
/// Repositories take this instead of <see cref="IMongoCollection{T}"/>, so
/// "remember to filter by userId" stops being a convention a reviewer has to
/// check and becomes something the compiler asks for: there is no overload
/// that omits it, and the userId equality clause is ANDed on in here, not at
/// the call site. Writes additionally assert the document's own UserId matches
/// the caller's, so a repository that forgets to stamp a new document fails
/// loudly instead of silently writing a row nobody can read (or worse, one the
/// wrong user can).
///
/// There is deliberately no way to get the raw handle back out. Index creation
/// and the migration - the only jobs that legitimately span users - take their
/// own IMongoCollection<T> straight from DI, so this type never needed an
/// escape hatch; the absence of one is asserted by
/// ArchitectureTests.UserScopingTests.
/// </remarks>
public sealed class UserScopedCollection<T> where T : IUserOwned
{
    // Name-based rather than an expression: T is only known as IUserOwned here,
    // so `x => x.UserId` would be a member access on the interface. Resolving
    // by name goes through the concrete type's class map instead, which is what
    // carries [BsonRepresentation(BsonType.String)].
    private static readonly FieldDefinition<T, Guid> UserIdField = new StringFieldDefinition<T, Guid>("UserId");

    private readonly IMongoCollection<T> _collection;

    public UserScopedCollection(IMongoCollection<T> collection) => _collection = collection;

    public static FilterDefinition<T> OwnedBy(Guid userId) => Builders<T>.Filter.Eq(UserIdField, userId);

    private static FilterDefinition<T> Scope(Guid userId, FilterDefinition<T> inner) =>
        Builders<T>.Filter.And(OwnedBy(userId), inner);

    // ── Reads ───────────────────────────────────────────────────────────────

    public IFindFluent<T, T> Find(Guid userId, FilterDefinition<T> filter, FindOptions? options = null) =>
        _collection.Find(Scope(userId, filter), options);

    public IFindFluent<T, T> Find(Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, FindOptions? options = null) =>
        _collection.Find(Scope(userId, Builders<T>.Filter.Where(filter)), options);

    public IFindFluent<T, T> FindAll(Guid userId, FindOptions? options = null) =>
        _collection.Find(OwnedBy(userId), options);

    // ── Writes ──────────────────────────────────────────────────────────────

    public Task InsertOneAsync(Guid userId, T document, CancellationToken ct = default)
    {
        AssertOwned(userId, document);
        return _collection.InsertOneAsync(document, cancellationToken: ct);
    }

    public Task InsertManyAsync(Guid userId, IEnumerable<T> documents, CancellationToken ct = default)
    {
        var list = documents.ToList();
        foreach (var d in list) AssertOwned(userId, d);
        return _collection.InsertManyAsync(list, cancellationToken: ct);
    }

    public Task<ReplaceOneResult> ReplaceOneAsync(
        Guid userId, FilterDefinition<T> filter, T document, ReplaceOptions? options = null, CancellationToken ct = default)
    {
        AssertOwned(userId, document);
        return _collection.ReplaceOneAsync(Scope(userId, filter), document, options, ct);
    }

    public Task<ReplaceOneResult> ReplaceOneAsync(
        Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, T document,
        ReplaceOptions? options = null, CancellationToken ct = default) =>
        ReplaceOneAsync(userId, Builders<T>.Filter.Where(filter), document, options, ct);

    public Task<UpdateResult> UpdateOneAsync(
        Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, UpdateDefinition<T> update,
        UpdateOptions? options = null, CancellationToken ct = default) =>
        _collection.UpdateOneAsync(Scope(userId, Builders<T>.Filter.Where(filter)), update, options, ct);

    public Task<DeleteResult> DeleteOneAsync(
        Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, CancellationToken ct = default) =>
        _collection.DeleteOneAsync(Scope(userId, Builders<T>.Filter.Where(filter)), ct);

    public Task<DeleteResult> DeleteOneAsync(
        IClientSessionHandle session, Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, CancellationToken ct = default) =>
        _collection.DeleteOneAsync(session, Scope(userId, Builders<T>.Filter.Where(filter)), cancellationToken: ct);

    public Task<DeleteResult> DeleteManyAsync(
        Guid userId, FilterDefinition<T> filter, CancellationToken ct = default) =>
        _collection.DeleteManyAsync(Scope(userId, filter), ct);

    public Task<DeleteResult> DeleteManyAsync(
        Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, CancellationToken ct = default) =>
        _collection.DeleteManyAsync(Scope(userId, Builders<T>.Filter.Where(filter)), ct);

    public Task<DeleteResult> DeleteManyAsync(
        IClientSessionHandle session, Guid userId, System.Linq.Expressions.Expression<Func<T, bool>> filter, CancellationToken ct = default) =>
        _collection.DeleteManyAsync(session, Scope(userId, Builders<T>.Filter.Where(filter)), cancellationToken: ct);

    // Batch upsert. The scoping and the ownership assertion happen in here for
    // every item, so a caller cannot hand BulkWrite a filter that reaches
    // another user's rows — there is no overload taking raw WriteModels.
    public async Task UpsertManyAsync(
        Guid userId, IEnumerable<(FilterDefinition<T> Filter, T Document)> items, CancellationToken ct = default)
    {
        var models = new List<WriteModel<T>>();
        foreach (var (filter, document) in items)
        {
            AssertOwned(userId, document);
            models.Add(new ReplaceOneModel<T>(Scope(userId, filter), document) { IsUpsert = true });
        }
        if (models.Count == 0) return;
        await _collection.BulkWriteAsync(models, cancellationToken: ct);
    }

    private static void AssertOwned(Guid userId, T document)
    {
        if (document.UserId != userId)
            throw new InvalidOperationException(
                $"Refusing to write a {typeof(T).Name} owned by {document.UserId} on behalf of user {userId}. " +
                "Stamp UserId on the document before writing it.");
    }
}
