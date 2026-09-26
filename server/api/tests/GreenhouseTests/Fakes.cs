using System.Net;
using System.Text;
using ApplicationTracker.Core.Greenhouse;
using ApplicationTracker.Greenhouse;
using ApplicationTracker.Infrastructure.Greenhouse;
using Microsoft.Extensions.Logging.Abstractions;

namespace GreenhouseTests;

/// <summary>
/// An HTTP handler that answers from a queue of canned responses and records
/// every request body it was sent.
/// </summary>
/// <remarks>
/// Real <see cref="HttpClient"/> plumbing rather than a mocked interface, so the
/// tests exercise the actual status-code branches, header reads and JSON
/// serialisation that production uses.
/// </remarks>
public sealed class StubHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses = new();

    public List<string> RequestBodies { get; } = [];
    public List<string> RequestUris { get; } = [];
    public int Calls => RequestUris.Count;

    public StubHandler Enqueue(Func<HttpRequestMessage, HttpResponseMessage> response)
    {
        _responses.Enqueue(response);
        return this;
    }

    public StubHandler EnqueueJson(HttpStatusCode status, string json) =>
        Enqueue(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        });

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestUris.Add(request.RequestUri?.ToString() ?? "");
        RequestBodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));

        if (_responses.Count == 0)
            throw new InvalidOperationException("StubHandler ran out of queued responses.");

        return _responses.Dequeue()(request);
    }
}

/// <summary>An embedding client that returns deterministic vectors and counts calls.</summary>
public sealed class FakeEmbeddingClient : IEmbeddingClient
{
    private readonly int _dimensions;
    private readonly Func<IReadOnlyList<string>, EmbeddingBatchResult>? _custom;

    public List<IReadOnlyList<string>> Batches { get; } = [];
    public List<string> InputTypes { get; } = [];

    public FakeEmbeddingClient(
        int dimensions = 4, Func<IReadOnlyList<string>, EmbeddingBatchResult>? custom = null)
    {
        _dimensions = dimensions;
        _custom = custom;
    }

    public Task<EmbeddingBatchResult> EmbedAsync(
        IReadOnlyList<string> texts, string inputType, CancellationToken ct)
    {
        Batches.Add([.. texts]);
        InputTypes.Add(inputType);

        if (_custom is not null) return Task.FromResult(_custom(texts));

        // The vector encodes its own text, so a misalignment is detectable by
        // reading the stored row back. A constant vector would make every
        // wrong pairing look right.
        var vectors = texts
            .Select(t => Enumerable.Repeat((float)t.GetHashCode(), _dimensions).ToArray())
            .ToList();

        return Task.FromResult(new EmbeddingBatchResult(vectors, texts.Sum(t => t.Length / 4)));
    }
}

/// <summary>
/// An in-memory <see cref="IJobStore"/>.
/// </summary>
/// <remarks>
/// Models only what the handler's own logic depends on. The Mongo semantics it
/// stands in for -- upsert on the unique key, clearing closedAt on reopen -- are
/// verified against a real collection in <c>JobStoreIntegrationTests</c>,
/// because a fake that implements them is evidence about the fake.
/// </remarks>
public sealed class FakeJobStore : IJobStore
{
    public Dictionary<long, string> Hashes { get; } = [];
    public Dictionary<long, float[]> Vectors { get; } = [];
    public List<int> UpsertBatchSizes { get; } = [];
    public List<long> Touched { get; } = [];

    public int CloseCalls { get; private set; }
    public IReadOnlyCollection<long>? LastCloseSeenIds { get; private set; }
    public long CloseReturns { get; set; }

    public Task<Dictionary<long, string>> StoredHashesAsync(string boardToken, CancellationToken ct) =>
        Task.FromResult(new Dictionary<long, string>(Hashes));

    public Task<(long Upserted, long Modified)> UpsertBatchAsync(
        IReadOnlyList<(GreenhouseJob Job, float[] Vector)> batch, string runId, DateTime now,
        CancellationToken ct)
    {
        UpsertBatchSizes.Add(batch.Count);
        foreach (var (job, vector) in batch)
        {
            Hashes[job.GreenhouseJobId] = job.ContentHash;
            Vectors[job.GreenhouseJobId] = vector;
        }
        return Task.FromResult(((long)batch.Count, 0L));
    }

    public Task<long> TouchAsync(
        string boardToken, IReadOnlyCollection<long> ids, string runId, DateTime now, CancellationToken ct)
    {
        Touched.AddRange(ids);
        return Task.FromResult((long)ids.Count);
    }

    public List<long> SavedAiFor { get; } = [];

    /// <summary>The facts document each save wrote, by job id.</summary>
    public Dictionary<long, MongoDB.Bson.BsonDocument> SavedFacts { get; } = [];

    /// <summary>Job ids a save wrote a parse for.</summary>
    public List<long> SavedParsedFor { get; } = [];

    public Task<long> SaveIngestAiAsync(
        string boardToken,
        IReadOnlyDictionary<long, MongoDB.Bson.BsonDocument> facts,
        IReadOnlyDictionary<long, MongoDB.Bson.BsonDocument> parsed,
        string? parseVersion, DateTime now, CancellationToken ct, bool countAttempt = true)
    {
        if (!countAttempt) UncountedSaves++;
        LastParseVersion = parseVersion ?? LastParseVersion;
        SavedAiFor.AddRange(facts.Keys.Union(parsed.Keys));
        foreach (var (id, f) in facts) SavedFacts[id] = f;
        SavedParsedFor.AddRange(parsed.Keys);
        return Task.FromResult((long)SavedAiFor.Count);
    }

    /// <summary>Saves made with countAttempt: false (batch parses).</summary>
    public int UncountedSaves { get; private set; }
    public string? LastParseVersion { get; private set; }

    /// <summary>Pending markers: (kind, job id) -> batch id.</summary>
    public Dictionary<(string Kind, long Id), string> Pending { get; } = [];

    public Task MarkAiPendingAsync(
        string boardToken, IReadOnlyCollection<long> ids, string kind, string batchId, CancellationToken ct)
    {
        foreach (var id in ids) Pending[(kind, id)] = batchId;
        return Task.CompletedTask;
    }

    public Task ClearAiPendingAsync(
        string boardToken, IReadOnlyCollection<long> ids, string kind, string batchId, CancellationToken ct)
    {
        foreach (var id in ids)
            if (Pending.TryGetValue((kind, id), out var owner) && owner == batchId)
                Pending.Remove((kind, id));
        return Task.CompletedTask;
    }

    /// <summary>What StoredContentForAsync returns, by id.</summary>
    public Dictionary<long, StoredJobContent> Stored { get; } = [];

    public Task<IReadOnlyList<StoredJobContent>> StoredContentForAsync(
        string boardToken, IReadOnlyCollection<long> ids, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<StoredJobContent>>(
            [.. ids.Where(Stored.ContainsKey).Select(i => Stored[i])]);

    /// <summary>Postings the backfill sweep should find. Empty by default.</summary>
    public List<StoredJobContent> NeedingAi { get; } = [];

    public int NeedingAiCalls { get; private set; }
    public int? LastNeedingAiLimit { get; private set; }

    public Task<IReadOnlyList<StoredJobContent>> NeedingIngestAiAsync(
        string boardToken, int limit, CancellationToken ct)
    {
        NeedingAiCalls++;
        LastNeedingAiLimit = limit;
        return Task.FromResult<IReadOnlyList<StoredJobContent>>([.. NeedingAi.Take(limit)]);
    }

    /// <summary>Postings the facts re-read should find. Empty by default.</summary>
    public List<StoredJobContent> NeedingFactsReRead { get; } = [];

    public int NeedingFactsReReadCalls { get; private set; }

    public Task<IReadOnlyList<StoredJobContent>> NeedingFactsReReadAsync(
        string boardToken, int limit, CancellationToken ct)
    {
        NeedingFactsReReadCalls++;
        return Task.FromResult<IReadOnlyList<StoredJobContent>>([.. NeedingFactsReRead.Take(limit)]);
    }

    /// <summary>The logo each stamp wrote, by board. A null value means it was cleared.</summary>
    public Dictionary<string, string?> StampedLogos { get; } = [];

    /// <summary>When set, the stamp throws this instead of writing.</summary>
    public Exception? StampThrows { get; set; }

    /// <summary>What StoredFunctionsAsync returns, by id.</summary>
    public Dictionary<long, string[]> Functions { get; } = [];

    public Task<Dictionary<long, string[]>> StoredFunctionsAsync(
        string boardToken, IReadOnlyCollection<long> ids, CancellationToken ct) =>
        Task.FromResult(ids.Where(Functions.ContainsKey).ToDictionary(i => i, i => Functions[i]));

    public Task<long> StampCompanyLogoAsync(string boardToken, string? logoUrl, CancellationToken ct)
    {
        if (StampThrows is not null) throw StampThrows;
        StampedLogos[boardToken] = logoUrl;
        return Task.FromResult(1L);
    }

    public Task<long> CloseMissingAsync(
        string boardToken, IReadOnlyCollection<long> seenIds, int emptyResponseGuardThreshold,
        DateTime now, CancellationToken ct)
    {
        CloseCalls++;
        LastCloseSeenIds = seenIds;
        return Task.FromResult(CloseReturns);
    }
}

internal static class Build
{
    public static BoardClient BoardClient(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("https://boards-api.greenhouse.io/") },
            NullLogger<BoardClient>.Instance);

    public static CompanyHandler Handler(
        StubHandler board, IEmbeddingClient embeddings, IJobStore store,
        CompaniesConfig? config = null,
        ApplicationTracker.Core.Matching.IngestAiClient? ai = null,
        PrefilterMode prefilter = PrefilterMode.Off,
        IFunctionDemand? demand = null,
        Microsoft.Extensions.Logging.ILogger<CompanyHandler>? log = null) =>
        new(BoardClient(board), embeddings, store,
            config ?? CompaniesConfig.ForTesting(Token), log ?? NullLogger<CompanyHandler>.Instance, ai,
            prefilter: prefilter, demand: demand);

    /// <summary>
    /// The board token every test uses.
    /// </summary>
    /// <remarks>
    /// Built in memory through <c>CompaniesConfig.ForTesting</c> and deliberately
    /// NOT a real company. No Greenhouse token appears in code or in a test --
    /// the only place a real one exists is <c>config/companies.json</c>, so
    /// going from one company to fifty stays an edit to that file and nothing
    /// else.
    /// </remarks>
    public const string Token = "test-board";

    public static string BoardJson(params (long Id, string Title, string Content)[] jobs) =>
        BoardJson(jobs.Length, jobs);

    /// <summary>Board JSON with an explicitly-set meta.total, for the truncation test.</summary>
    public static string BoardJson(int metaTotal, params (long Id, string Title, string Content)[] jobs)
    {
        var items = jobs.Select(j => $$"""
            {
              "id": {{j.Id}},
              "title": {{System.Text.Json.JsonSerializer.Serialize(j.Title)}},
              "absolute_url": "https://boards.greenhouse.io/x/jobs/{{j.Id}}",
              "company_name": "Test Co",
              "location": { "name": "Tel Aviv" },
              "departments": [ { "id": 1, "name": "Engineering" } ],
              "offices": [ { "id": 2, "name": "Tel Aviv" } ],
              "content": {{System.Text.Json.JsonSerializer.Serialize(j.Content)}}
            }
            """);

        return $$"""{ "jobs": [ {{string.Join(",", items)}} ], "meta": { "total": {{metaTotal}} } }""";
    }
}
