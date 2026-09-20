using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Infrastructure.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// <see cref="MongoCandidateJobStore"/> against a real collection and a real
/// Atlas vector index.
/// </summary>
/// <remarks>
/// <para>
/// <b>Skipped unless explicitly pointed at a database.</b> It needs an Atlas
/// cluster with a built vector index and a billed Voyage key, so it cannot run
/// in CI and must never run by accident. Set all four:
/// </para>
/// <code>
/// GREENHOUSE_IT_MONGO=mongodb+srv://...
/// GREENHOUSE_IT_DB=job-tracker-greenhouse-scratch
/// GREENHOUSE_IT_VOYAGE_KEY=pa-...
/// GREENHOUSE_IT_ENABLED=1
/// </code>
/// <para>
/// It exists because the alternative was verifying the vector search by hand
/// with a script that re-implemented the pipeline. A clean result from an
/// instrument that cannot see the code is worse than no result: it licenses the
/// change. This drives <c>FindCandidateJobIds</c> itself, so the index name,
/// the field path, the dimension count, the filter shape and the <c>query</c>
/// input type are all the ones production uses.
/// </para>
/// <para>
/// <b>Read-only.</b> Every test here queries; the only write is the one that
/// closes a job, and it restores it in a finally block.
/// </para>
/// </remarks>
public class CandidateRetrievalIntegrationTests
{
    private static bool Enabled => Environment.GetEnvironmentVariable("GREENHOUSE_IT_ENABLED") == "1";

    private static string Env(string name) =>
        Environment.GetEnvironmentVariable(name)
        ?? throw new InvalidOperationException($"{name} is not set.");

    private static (IMongoCollection<BsonDocument> Jobs, MongoCandidateJobStore Store) Build()
    {
        var jobs = new MongoClient(Env("GREENHOUSE_IT_MONGO"))
            .GetDatabase(Env("GREENHOUSE_IT_DB"))
            .GetCollection<BsonDocument>(GreenhouseJobFields.Collection);

        var options = new GreenhouseEmbeddingOptions
        {
            ApiKey = Env("GREENHOUSE_IT_VOYAGE_KEY"),
            Model = "voyage-4",
            Dimensions = 1024,
        };

        var http = new HttpClient { BaseAddress = new Uri(options.BaseUrl) };
        http.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", options.ApiKey);

        var embeddings = new VoyageEmbeddingClient(
            http, options, NullLogger<VoyageEmbeddingClient>.Instance);

        return (jobs, new MongoCandidateJobStore(jobs, embeddings, NullLogger<MongoCandidateJobStore>.Instance));
    }

    /// <summary>
    /// A rendered profile, in the shape <c>ProfileRenderer</c> produces.
    /// </summary>
    /// <remarks>
    /// Synthetic rather than the real user's profile: a test that reads
    /// production profile data would be untestable by anyone else and would put
    /// personal content in CI output. The shape is what matters -- a long
    /// descriptive document, not a job title, because the stored vectors
    /// describe 4,000-character postings.
    /// </remarks>
    private const string EngineerProfile = """
        <professional_profile>

        <summary>
        Backend engineer with a decade building distributed services and data
        platforms. Strongest in Go and Python, running services on Kubernetes,
        with PostgreSQL and Kafka behind them. Comfortable owning a system end
        to end: schema design, deployment, on-call and the incident review.
        </summary>

        <profile_meta>
        - Seniority: Senior Backend Engineer
        - Domains: data infrastructure, developer platform
        </profile_meta>

        <skills>
        - Languages: Go, Python, SQL
        - Infrastructure: Kubernetes, Docker, Terraform, AWS
        - Data: PostgreSQL, Kafka, Redis, Airflow
        </skills>

        </professional_profile>
        """;

    [SkippableFact]
    public async Task Returns_greenhouse_job_ids_for_a_profile()
    {
        Skip.IfNot(Enabled, "Set GREENHOUSE_IT_ENABLED=1 and the Atlas/Voyage variables to run.");

        var (jobs, store) = Build();

        var stored = await jobs.CountDocumentsAsync(FilterDefinition<BsonDocument>.Empty);
        Assert.True(stored > 0, "The collection is empty; run the ingest first or this verifies nothing.");

        var ids = await store.FindCandidateJobIds(EngineerProfile, new CandidateJobFilters(), n: 10);

        Assert.NotEmpty(ids);
        Assert.True(ids.Count <= 10);
        Assert.Equal(ids.Count, ids.Distinct().Count());

        // Every id must be a real row in this collection -- proof it queried the
        // right collection through the right index, not that it returned
        // plausible-looking strings.
        foreach (var id in ids)
            Assert.Equal(1, await jobs.CountDocumentsAsync(
                Builders<BsonDocument>.Filter.Eq("_id", ObjectId.Parse(id))));
    }

    [SkippableFact]
    public async Task Ranks_a_relevant_posting_above_an_unrelated_one()
    {
        Skip.IfNot(Enabled, "Set GREENHOUSE_IT_ENABLED=1 and the Atlas/Voyage variables to run.");

        var (jobs, store) = Build();

        // Asking for a handful, not the whole board: a limit large enough to
        // return everything proves nothing about ranking.
        var ids = await store.FindCandidateJobIds(EngineerProfile, new CandidateJobFilters(), n: 5);
        Skip.If(ids.Count < 5, "Too few rows stored to say anything about ranking.");

        var titles = await jobs
            .Find(Builders<BsonDocument>.Filter.In("_id", ids.Select(ObjectId.Parse)))
            .Project(Builders<BsonDocument>.Projection.Include(GreenhouseJobFields.Title))
            .ToListAsync();

        // Deliberately weak: this is a recall prefilter, and a strong assertion
        // about ordering would be an assertion about Voyage's model rather than
        // about this code. What must hold is that an engineering profile pulls
        // back engineering-shaped work rather than an arbitrary slice.
        var engineering = titles.Count(t =>
            t.GetValue(GreenhouseJobFields.Title, "").AsString is { } title
            && (title.Contains("Engineer", StringComparison.OrdinalIgnoreCase)
                || title.Contains("Developer", StringComparison.OrdinalIgnoreCase)
                || title.Contains("Data", StringComparison.OrdinalIgnoreCase)
                || title.Contains("Architect", StringComparison.OrdinalIgnoreCase)
                || title.Contains("DevOps", StringComparison.OrdinalIgnoreCase)));

        Assert.True(engineering >= 3,
            $"Only {engineering} of the top {titles.Count} were engineering roles: "
            + string.Join(", ", titles.Select(t => t.GetValue(GreenhouseJobFields.Title, "?"))));
    }

    [SkippableFact]
    public async Task Excludes_closed_listings_and_includes_them_on_request()
    {
        Skip.IfNot(Enabled, "Set GREENHOUSE_IT_ENABLED=1 and the Atlas/Voyage variables to run.");

        var (jobs, store) = Build();

        // Close the top hit, then prove it disappears. Closing an ARBITRARY row
        // would prove nothing: it might not have been in the results anyway.
        var before = await store.FindCandidateJobIds(EngineerProfile, new CandidateJobFilters(), n: 5);
        Skip.If(before.Count == 0, "Nothing stored to close.");

        var victim = ObjectId.Parse(before[0]);
        var filter = Builders<BsonDocument>.Filter.Eq("_id", victim);

        await jobs.UpdateOneAsync(filter,
            Builders<BsonDocument>.Update.Set(GreenhouseJobFields.ClosedAt, DateTime.UtcNow));

        try
        {
            // Atlas applies the filter inside the index, which updates
            // asynchronously after a write. Poll rather than assume.
            var gone = false;
            for (var attempt = 0; attempt < 20 && !gone; attempt++)
            {
                var after = await store.FindCandidateJobIds(
                    EngineerProfile, new CandidateJobFilters(), n: 5);
                gone = !after.Contains(before[0]);
                if (!gone) await Task.Delay(1000);
            }

            Assert.True(gone,
                "A closed listing was still returned. It is kept forever and stays a perfect "
                + "vector match for the profile it was written for, so without the filter it "
                + "would crowd out live postings nobody can apply to.");

            var withClosed = await store.FindCandidateJobIds(
                EngineerProfile, new CandidateJobFilters(IncludeClosed: true), n: 50);

            Assert.Contains(before[0], withClosed);
        }
        finally
        {
            // Never delete, and never leave the collection altered by a test.
            await jobs.UpdateOneAsync(filter,
                Builders<BsonDocument>.Update.Set(GreenhouseJobFields.ClosedAt, BsonNull.Value));
        }
    }

    [SkippableFact]
    public async Task An_unstated_fact_does_not_hide_a_job()
    {
        Skip.IfNot(Enabled, "Set GREENHOUSE_IT_ENABLED=1 and the Atlas/Voyage variables to run.");

        var (_, store) = Build();

        // Every stored row has extracted: null, because this ingest runs no
        // extraction yet. A seniority filter must therefore still return them:
        // "matches OR is unstated" is PoolJobRepository's rule, and if the
        // vector filter did not share it, every Greenhouse job would vanish the
        // moment a caller passed a band -- silently, as an empty list.
        var ids = await store.FindCandidateJobIds(
            EngineerProfile,
            new CandidateJobFilters(Seniority: ["mid-senior level"]),
            n: 10);

        Assert.NotEmpty(ids);
    }
}
