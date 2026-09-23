using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.AI;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ArchitectureTests;

/// <summary>
/// The API half of the ingest's batch reads: what ClaudeClient submits to the
/// Message Batches API, and how it reads the results back.
/// </summary>
/// <remarks>
/// Driven through the real Anthropic.SDK over a stub HTTP handler, so the
/// requests asserted on are the ones the SDK actually sends. The claim being
/// protected is "same answers at half the price": a batch request must be the
/// request the live call makes, and a result the live path would reject must
/// not be stored either.
/// </remarks>
public class ClaudeIngestBatchTests
{
    private sealed class AnthropicStub : HttpMessageHandler
    {
        public List<(string Method, string Path, string Body)> Requests { get; } = [];
        public string Status { get; set; } = "ended";
        public string ResultsJsonl { get; set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add((request.Method.Method, path, body));

            if (path.EndsWith("/results"))
                return Text(ResultsJsonl, "application/x-jsonl");

            if (request.Method == HttpMethod.Post)
                return Json("""{ "id": "msgbatch_test", "type": "message_batch", "processing_status": "in_progress" }""");

            return Json($$"""
                { "id": "msgbatch_test", "type": "message_batch", "processing_status": "{{Status}}",
                  "results_url": "https://api.anthropic.com/v1/messages/batches/msgbatch_test/results" }
                """);
        }

        private static HttpResponseMessage Json(string json) => Text(json, "application/json");

        private static HttpResponseMessage Text(string text, string type) =>
            new(HttpStatusCode.OK) { Content = new StringContent(text, Encoding.UTF8, type) };
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    /// <summary>Never called on these paths; throws if that changes.</summary>
    public class Unused : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) =>
            throw new NotSupportedException(targetMethod?.Name);
    }

    private static ClaudeClient Client(AnthropicStub stub) => new(
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Anthropic:ApiKey"] = "sk-test" })
            .Build(),
        new StubFactory(stub),
        new HttpContextAccessor(),
        new PromptBuilder(NullLogger<PromptBuilder>.Instance),
        DispatchProxy.Create<IProfileProvider, Unused>(),
        new PromptOptions(),
        new ScoringConfig(),
        NullLogger<ClaudeClient>.Instance);

    private static JobFactsRequest Facts(int count) => new()
    {
        Jobs = [.. Enumerable.Range(1, count).Select(i => new JobFactsItem
        {
            JobId = i.ToString(), Title = "Engineer", Description = "A posting.",
        })],
    };

    // One results line, in the documented JSONL shape.
    private static string Line(string customId, string text, string stopReason = "end_turn") =>
        JsonSerializer.Serialize(new
        {
            custom_id = customId,
            result = new
            {
                type = "succeeded",
                message = new
                {
                    content = new[] { new { type = "text", text } },
                    stop_reason = stopReason,
                    usage = new { input_tokens = 100, output_tokens = 50 },
                },
            },
        });

    [Fact]
    public async Task A_facts_batch_is_the_live_request_one_chunk_per_request()
    {
        var stub = new AnthropicStub();

        var submitted = await Client(stub).SubmitJobFactsBatchAsync(Facts(25));

        Assert.Equal("msgbatch_test", submitted.BatchId);
        Assert.Equal(3, submitted.Requests);   // 12 + 12 + 1, the live chunk size

        var (method, path, body) = stub.Requests.Single();
        Assert.Equal("POST", method);
        Assert.EndsWith("/v1/messages/batches", path);

        using var doc = JsonDocument.Parse(body);
        var requests = doc.RootElement.GetProperty("requests").EnumerateArray().ToList();
        Assert.Equal(["c0", "c1", "c2"], requests.Select(r => r.GetProperty("custom_id").GetString()));

        var first = requests[0].GetProperty("params");
        Assert.Equal(new ScoringConfig().Analyst.Model, first.GetProperty("model").GetString());
        // Decoded, not raw: the SDK escapes '<' in the JSON it sends.
        var system = first.GetProperty("system").EnumerateArray().Single().GetProperty("text").GetString();
        var user = first.GetProperty("messages")[0].GetProperty("content")[0].GetProperty("text").GetString();
        Assert.StartsWith("You extract stated requirements from job postings", system);
        Assert.StartsWith("<scraped_jobs>", user);
    }

    [Fact]
    public async Task An_unfinished_batch_returns_no_results()
    {
        var stub = new AnthropicStub { Status = "in_progress" };

        var result = await Client(stub).CollectJobFactsBatchAsync("msgbatch_test");

        Assert.Equal(IngestBatchStatus.InProgress, result.Status);
        Assert.Empty(result.Results);
        Assert.DoesNotContain(stub.Requests, r => r.Path.EndsWith("/results"));
    }

    [Fact]
    public async Task Collected_facts_are_normalised_like_live_ones_and_failures_contribute_nothing()
    {
        var stub = new AnthropicStub
        {
            ResultsJsonl = string.Join('\n',
                Line("c0", """{ "results": [ { "jobId": "1", "mustHaveTech": ["Go"], "niceToHaveTech": [], "functions": ["Infrastructure", "wizardry"] } ] }"""),
                // Truncated: the live path throws on this; stored, it would be half a read.
                Line("c1", """{ "results": [ { "jobId": "2", "mustHave""", stopReason: "max_tokens"),
                JsonSerializer.Serialize(new { custom_id = "c2", result = new { type = "expired" } }),
                Line("c3", "not json at all")),
        };

        var result = await Client(stub).CollectJobFactsBatchAsync("msgbatch_test");

        Assert.Equal(IngestBatchStatus.Ended, result.Status);
        var facts = Assert.Single(result.Results);
        Assert.Equal("1", facts.JobId);
        // The same normalisation the live path applies: off-list function
        // dropped, spelling folded, groups derived.
        Assert.Equal(["infrastructure"], facts.Functions);
        Assert.Equal([["Go"]], facts.MustHaveGroups);
        Assert.Equal(3, result.FailedRequests);
    }

    [Fact]
    public async Task Collected_parses_are_limited_to_the_postings_sent_to_verify_them()
    {
        var stub = new AnthropicStub
        {
            ResultsJsonl = Line("c0", """
                { "results": [
                    { "id": "1", "parsed": { "jobTitle": "Model title" } },
                    { "id": "2", "parsed": { "jobTitle": "Not ours" } } ] }
                """),
        };
        var request = new JobParseRequest
        {
            Jobs = [new JobParseItem { JobId = "1", Title = "Board title", Description = "A posting." }],
        };

        var result = await Client(stub).CollectJobParseBatchAsync("msgbatch_test", request);

        var parse = Assert.Single(result.Results);
        Assert.Equal("1", parse.JobId);
        // The board's title wins, as on the live path.
        Assert.Equal("Board title", parse.Parsed.JobTitle);
    }
}
