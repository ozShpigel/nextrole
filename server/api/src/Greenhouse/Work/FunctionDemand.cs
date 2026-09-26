using ApplicationTracker.Core.Models;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>Which job functions the product's users want, for the pre-read filter.</summary>
public interface IFunctionDemand
{
    /// <summary>
    /// The functions at least one user holds, or an empty list when none is
    /// recorded -- which the filter reads as "skip nothing by function".
    /// </summary>
    Task<IReadOnlyList<string>> WantedAsync(CancellationToken ct);
}

/// <summary>
/// Reads <c>pool_functions</c>, which the API keeps in step with profile saves
/// (<c>PoolFunctionRepository</c>). One small read per board.
/// </summary>
/// <remarks>
/// Typed as the API's own <see cref="PoolFunction"/>, not a BsonDocument with
/// field names spelled a second time: the two processes agree on the shape
/// because there is one class. A mismatch would be silent -- no demand found
/// reads as "filter nothing by function" -- so it is not left to a comment.
/// </remarks>
public sealed class PoolFunctionDemand(IMongoCollection<PoolFunction> functions) : IFunctionDemand
{
    public static PoolFunctionDemand For(IMongoDatabase database) =>
        new(database.GetCollection<PoolFunction>(PoolFunction.CollectionName));

    public async Task<IReadOnlyList<string>> WantedAsync(CancellationToken ct) =>
        await functions
            .Find(Builders<PoolFunction>.Filter.SizeGt(f => f.UserIds, 0))
            .Project(f => f.Id)
            .ToListAsync(ct);
}
