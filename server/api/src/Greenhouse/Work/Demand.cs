using ApplicationTracker.Core.Models;
using MongoDB.Driver;

namespace ApplicationTracker.Greenhouse;

/// <summary>What the product's users want, for the pre-read filter.</summary>
public interface IDemand
{
    /// <summary>
    /// The functions at least one user holds, or an empty list when none is
    /// recorded -- which the filter reads as "skip nothing by function".
    /// </summary>
    Task<IReadOnlyList<string>> WantedFunctionsAsync(CancellationToken ct);

    /// <summary>
    /// The location terms of users' profiles ("tel aviv", "israel"), served
    /// on top of <c>served_locations</c> in companies.json.
    /// </summary>
    Task<IReadOnlyList<string>> WantedLocationsAsync(CancellationToken ct);
}

/// <summary>
/// Reads <c>pool_functions</c> and <c>pool_locations</c>, which the API keeps in
/// step with profile saves (<c>PoolDemandRepository</c>). Two small reads per
/// board.
/// </summary>
/// <remarks>
/// Typed as the API's own <see cref="PoolDemand"/>, not a BsonDocument with
/// field names spelled a second time: the two processes agree on the shape
/// because there is one class. A mismatch would be silent -- no demand found
/// reads as "filter nothing by function", and no learned location reads as
/// "only the configured ones".
/// </remarks>
public sealed class PoolDemandReader(
    IMongoCollection<PoolDemand> functions, IMongoCollection<PoolDemand> locations) : IDemand
{
    public static PoolDemandReader For(IMongoDatabase database) => new(
        database.GetCollection<PoolDemand>(PoolDemand.FunctionsCollection),
        database.GetCollection<PoolDemand>(PoolDemand.LocationsCollection));

    public Task<IReadOnlyList<string>> WantedFunctionsAsync(CancellationToken ct) => WantedAsync(functions, ct);

    public Task<IReadOnlyList<string>> WantedLocationsAsync(CancellationToken ct) => WantedAsync(locations, ct);

    private static async Task<IReadOnlyList<string>> WantedAsync(
        IMongoCollection<PoolDemand> collection, CancellationToken ct) =>
        await collection
            .Find(Builders<PoolDemand>.Filter.SizeGt(d => d.UserIds, 0))
            .Project(d => d.Id)
            .ToListAsync(ct);
}
