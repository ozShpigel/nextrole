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
/// <b>The board repository is always the job source</b> -- the retired LinkedIn
/// pool that used to be the default was removed on 2026-10-04, and with it the
/// <c>Greenhouse:UseAsJobSource</c> switch. What depends on a key is only the
/// candidate search: with no embedding key it is
/// <see cref="UnconfiguredCandidateJobStore"/>, which refuses a scan by name,
/// so the API still starts and Matches still lists stored postings. Embedding
/// is a billed call: a half-configured deployment must not look as if it works.
/// </para>
/// </remarks>
public static class GreenhouseExtensions
{
    /// <summary>
    /// A distinct DI key for the Greenhouse collection.
    /// </summary>
    /// <remarks>
    /// Keyed rather than registered as the unkeyed
    /// <c>IMongoCollection&lt;BsonDocument&gt;</c>: an untyped collection handle is
    /// the easiest thing to resolve by accident, and a vector search pointed at
    /// the wrong collection returns nothing, with no error.
    /// </remarks>
    public const string CollectionKey = "greenhouse_jobs";

    public static IServiceCollection AddGreenhouseRetrieval(
        this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(GreenhouseEmbeddingOptions.SectionName)
            .Get<GreenhouseEmbeddingOptions>() ?? new GreenhouseEmbeddingOptions();

        services.AddKeyedSingleton<IMongoCollection<BsonDocument>>(CollectionKey, (sp, _) =>
            sp.GetRequiredService<IMongoDatabase>()
                .GetCollection<BsonDocument>(GreenhouseJobFields.Collection));

        if (string.IsNullOrWhiteSpace(options.ApiKey))
        {
            services.AddSingleton<ICandidateJobStore, UnconfiguredCandidateJobStore>();
        }
        else
        {
            options.Validate();
            services.AddSingleton(options);

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
        }

        // The scan cap travels with the source (see
        // GreenhouseJobRepository.DefaultMaxCandidatesPerScan). Configurable so
        // the ranked source's depth can be tuned on the box.
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

        return services;
    }
}
