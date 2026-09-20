using ApplicationTracker.Core.Greenhouse;
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

        return services;
    }
}
