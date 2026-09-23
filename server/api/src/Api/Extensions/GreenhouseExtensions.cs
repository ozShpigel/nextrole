using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Repositories;
using ApplicationTracker.Infrastructure.Greenhouse;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.Api.Extensions;

/// <summary>
/// The API's read side of the Greenhouse source: <see cref="ICandidateJobStore"/>.
/// </summary>
/// <remarks>
/// <para>
/// The API reads this collection and never writes it. Ingestion is a separate
/// process (<c>ApplicationTracker.Greenhouse</c>), and the only thing the two
/// share is Core/Infrastructure -- the embedding client, the model, the
/// dimensions and the stored document model.
/// </para>
/// <para>
/// <b>That sharing is the point of registering it this way.</b> Retrieval and
/// ingestion differ in exactly one thing, <c>input_type</c>, and must agree on
/// everything else. If they disagreed about the model or the dimensions,
/// <c>$vectorSearch</c> would return an empty list rather than an error, and
/// the prefilter would quietly stop finding good jobs.
/// </para>
/// <para>
/// Registration is <b>conditional on a key being configured</b>. Without one
/// the services are simply absent, the API starts normally, and any caller
/// resolving <see cref="ICandidateJobStore"/> optionally gets null. Embedding
/// is a billed call: a half-configured deployment must not start up and then
/// fail per request.
/// </para>
/// </remarks>
public static class GreenhouseExtensions
{
    /// <summary>
    /// A distinct DI key for the Greenhouse collection.
    /// </summary>
    /// <remarks>
    /// <c>IMongoCollection&lt;BsonDocument&gt;</c> is already registered
    /// unkeyed, and it is <c>discovered_jobs</c>. Registering this one unkeyed
    /// would silently hand the LinkedIn pool to whichever of the two resolved
    /// second -- so the vector search would run against a collection with no
    /// vectors, and return nothing, with no error.
    /// </remarks>
    public const string CollectionKey = "greenhouse_jobs";

    public static IServiceCollection AddGreenhouseRetrieval(
        this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(GreenhouseEmbeddingOptions.SectionName)
            .Get<GreenhouseEmbeddingOptions>() ?? new GreenhouseEmbeddingOptions();

        if (string.IsNullOrWhiteSpace(options.ApiKey))
            return services;

        options.Validate();
        services.AddSingleton(options);

        services.AddKeyedSingleton<IMongoCollection<BsonDocument>>(CollectionKey, (sp, _) =>
            sp.GetRequiredService<IMongoDatabase>()
                .GetCollection<BsonDocument>(GreenhouseJobFields.Collection));

        services.AddHttpClient<IEmbeddingClient, VoyageEmbeddingClient>(client =>
        {
            client.BaseAddress = new Uri(options.BaseUrl);
            client.Timeout = TimeSpan.FromMinutes(2);
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", options.ApiKey);
        });

        services.AddSingleton<ICandidateJobStore>(sp => new MongoCandidateJobStore(
            sp.GetRequiredKeyedService<IMongoCollection<BsonDocument>>(CollectionKey),
            sp.GetRequiredService<IEmbeddingClient>(),
            sp.GetRequiredService<ILogger<MongoCandidateJobStore>>()));

        // THE SOURCE SWITCH.
        //
        // Greenhouse:UseAsJobSource=true makes greenhouse_jobs the collection
        // every matching path reads: the scan's candidate search, the Matches
        // page's browse, and the "n of m considered" count. discovered_jobs is
        // then read by nothing.
        //
        // Registered LAST so it replaces the PoolJobRepository that
        // AddApplicationServices registered -- the last registration of a
        // service type is the one resolved. Flipping the flag back restores the
        // LinkedIn pool with no code change, which is why the pool's cron keeps
        // running and its data is left intact.
        if (configuration.GetValue("Greenhouse:UseAsJobSource", false))
        {
            // The scan cap travels with the source (see
            // GreenhouseJobRepository.DefaultMaxCandidatesPerScan). Configurable
            // only so the ranked source's depth can be tuned on the box while it
            // beds in; it cannot reach the LinkedIn pool's cap, which is the
            // point of it being a constructor argument here rather than a
            // setting the scan reads.
            var maxCandidates = configuration.GetValue(
                "Greenhouse:MaxCandidatesPerScan",
                GreenhouseJobRepository.DefaultMaxCandidatesPerScan);

            // Off until the function labels on stored postings have been read
            // by eye; until then the repository only logs what it would drop.
            var filterByFunction = configuration.GetValue("Greenhouse:FilterByFunction", false);

            services.AddScoped<IPoolJobRepository>(sp => new GreenhouseJobRepository(
                sp.GetRequiredKeyedService<IMongoCollection<BsonDocument>>(CollectionKey),
                sp.GetRequiredService<ICandidateJobStore>(),
                sp.GetRequiredService<ILogger<GreenhouseJobRepository>>(),
                maxCandidates,
                filterByFunction));
        }

        return services;
    }
}
