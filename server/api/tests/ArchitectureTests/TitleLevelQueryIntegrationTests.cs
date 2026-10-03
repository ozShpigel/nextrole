using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Infrastructure.Greenhouse;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ArchitectureTests;

/// <summary>
/// The Mongo filter the Matches page runs agrees with <see cref="TitleLevel.Of"/>,
/// title for title. The two are built from the same patterns, but one runs in
/// .NET and the other in MongoDB's regex engine, and the "one level per title"
/// rule is expressed twice (a loop there, $not clauses here) -- so it is
/// checked, not assumed. Skips without a reachable Mongo (NEXTROLE_TEST_MONGO).
/// </summary>
public class TitleLevelQueryIntegrationTests : IAsyncLifetime
{
    private static readonly string[] Titles =
    [
        "Legal Intern", "Security Analyst (Student Position)", "Graduate QA Automation Engineer",
        "Associate Customer Success Engineer - France", "Associate Director of Sales",
        "Software Engineer", "Product Manager", "Internal Tools Engineer", "Leadership Coach",
        "Senior Backend Engineer (Applied AI)", "Sr. DevOps Engineer", "Senior Staff Engineer",
        "Senior Architect", "Backend Team Lead", "SW Development Team Leader", "System Architect",
        "Director, Web Strategy", "VP of Product Marketing", "Head of Platform",
        "Senior Software Engineering Intern", "LLM Inference Engineer", "Email Marketing Manager",
        "Machine Learning Engineer", "Data Engineer",
    ];

    private MongoClient? _client;
    private string _dbName = "";
    private IMongoCollection<BsonDocument>? _jobs;

    public async Task InitializeAsync()
    {
        var uri = Environment.GetEnvironmentVariable("NEXTROLE_TEST_MONGO") ?? "mongodb://localhost:27017";
        var settings = MongoClientSettings.FromConnectionString(uri);
        settings.ServerSelectionTimeout = TimeSpan.FromSeconds(2);
        List<string> existing;
        try
        {
            var client = new MongoClient(settings);
            existing = await (await client.ListDatabaseNamesAsync()).ToListAsync();
            _client = client;
        }
        catch
        {
            return;   // no Mongo; every test skips
        }

        _dbName = $"nextrole-titleleveltest-{Guid.NewGuid().ToString("N")[..8]}";
        // Never write into a database that already exists (AGENTS.md, Testing).
        if (existing.Contains(_dbName))
            throw new InvalidOperationException($"Refusing to seed into existing database {_dbName}");

        _jobs = _client.GetDatabase(_dbName).GetCollection<BsonDocument>("greenhouse_jobs");
        await _jobs.InsertManyAsync(Titles.Select(t => new BsonDocument { { GreenhouseJobFields.Title, t } }));
    }

    public async Task DisposeAsync()
    {
        if (_client is not null) await _client.DropDatabaseAsync(_dbName);
    }

    [Fact]
    public async Task Each_level_query_returns_exactly_the_titles_Of_assigns_to_it()
    {
        if (_jobs is null) return;

        foreach (var level in TitleLevel.All)
        {
            var found = (await _jobs.Find(GreenhouseJobRepository.TitleLevelClause(level)).ToListAsync())
                .Select(d => d[GreenhouseJobFields.Title].AsString).Order().ToList();
            var expected = Titles.Where(t => TitleLevel.Of(t) == level).Order().ToList();
            Assert.True(expected.SequenceEqual(found),
                $"{level}: expected [{string.Join(", ", expected)}] got [{string.Join(", ", found)}]");
        }
    }

    [Fact]
    public async Task The_ai_query_returns_exactly_the_titles_IsAiRole_accepts()
    {
        if (_jobs is null) return;

        var filter = Builders<BsonDocument>.Filter.Regex(
            GreenhouseJobFields.Title, new BsonRegularExpression(TitleLevel.AiPattern, "i"));
        var found = (await _jobs.Find(filter).ToListAsync())
            .Select(d => d[GreenhouseJobFields.Title].AsString).Order();
        Assert.Equal(Titles.Where(TitleLevel.IsAiRole).Order(), found);
    }
}
