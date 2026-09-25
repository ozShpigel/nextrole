using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;
using ApplicationTracker.Infrastructure.AI;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ArchitectureTests;

/// <summary>
/// The short first read of an uploaded résumé: what it asks for, and that
/// nothing outside the essentials survives it.
/// </summary>
/// <remarks>
/// The client merges this read into the profile field by field while the full
/// read is still running. A stray field here -- highlights, education -- would
/// be merged over the profile's own, so "only the essentials" has to hold in
/// code, not only in the prompt.
/// </remarks>
public class NormalizeEssentialsTests
{
    private static NormalizedProfile Full() => new()
    {
        FullName = "Oz", Email = "a@b.c", Phone = "1", LinkedIn = "in/oz",
        Location = "Tel Aviv, Israel",
        Summary = "Infra engineer.",
        Seniority = "Senior",
        Domains = ["fintech"],
        Functions = ["infrastructure"],
        Skills = [new SkillGroup { Category = "Platform", Items = ["Kubernetes"] }],
        Experience = [new ExperienceItem { Title = "Platform Developer", Company = "Payoneer", Dates = "2023–2026", Highlights = ["Owned X"] }],
        Education = [new CredentialItem { Institution = "HIT", Detail = "B.Sc." }],
        MilitaryService = [new CredentialItem { Institution = "IAF", Detail = "Engineer" }],
        SideProjects = [new SideProjectItem { Name = "NextRole" }],
        SpokenLanguages = ["Hebrew"],
    };

    [Fact]
    public void Keep_retains_what_retrieval_needs_and_clears_everything_else()
    {
        var kept = NormalizedProfileEssentials.Keep(Full());

        Assert.Equal("Tel Aviv, Israel", kept.Location);
        Assert.Equal("Infra engineer.", kept.Summary);
        Assert.Equal("Senior", kept.Seniority);
        Assert.Equal(["infrastructure"], kept.Functions);
        Assert.Equal("Kubernetes", kept.Skills.Single().Items.Single());
        var role = kept.Experience.Single();
        Assert.Equal(("Platform Developer", "Payoneer", "2023–2026"), (role.Title, role.Company, role.Dates));

        Assert.Empty(role.Highlights);
        Assert.Null(kept.FullName);
        Assert.Null(kept.Email);
        Assert.Empty(kept.Education);
        Assert.Empty(kept.MilitaryService);
        Assert.Empty(kept.SideProjects);
        Assert.Empty(kept.SpokenLanguages);
    }

    // ---- the request, through the real SDK --------------------------------

    private sealed class MessagesStub(string responseText) : HttpMessageHandler
    {
        public string? Body;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            var json = JsonSerializer.Serialize(new
            {
                id = "msg_test", type = "message", role = "assistant", model = "claude-haiku-4-5",
                content = new[] { new { type = "text", text = responseText } },
                stop_reason = "end_turn",
                usage = new { input_tokens = 3000, output_tokens = 300 },
            });
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    public class Unused : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) =>
            throw new NotSupportedException(targetMethod?.Name);
    }

    private static ClaudeClient Client(HttpMessageHandler stub) => new(
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

    private const string ModelOverreaches = """
        { "summary": "Infra engineer.", "location": "Tel Aviv, Israel", "functions": ["Infrastructure", "wizardry"],
          "experience": [ { "title": "Platform Developer", "company": "Payoneer", "dates": "2023", "highlights": ["Owned X"] } ],
          "education": [ { "institution": "HIT", "detail": "B.Sc." } ] }
        """;

    [Fact]
    public async Task The_essentials_read_asks_for_the_short_answer_and_keeps_only_it()
    {
        var stub = new MessagesStub(ModelOverreaches);

        var read = await Client(stub).NormalizeProfileAsync("A résumé.", essentialsOnly: true);

        using var body = JsonDocument.Parse(stub.Body!);
        Assert.Equal(1536, body.RootElement.GetProperty("max_tokens").GetInt32());
        Assert.Contains("ESSENTIALS MODE", body.RootElement.GetProperty("system").ToString());

        // The model filled more than it was asked for; the code check clears it.
        Assert.Empty(read.Experience.Single().Highlights);
        Assert.Empty(read.Education);
        Assert.Equal(["infrastructure"], read.Functions);
    }

    [Fact]
    public async Task The_full_read_is_unchanged()
    {
        var stub = new MessagesStub(ModelOverreaches);

        var read = await Client(stub).NormalizeProfileAsync("A résumé.");

        using var body = JsonDocument.Parse(stub.Body!);
        Assert.Equal(4096, body.RootElement.GetProperty("max_tokens").GetInt32());
        Assert.DoesNotContain("ESSENTIALS MODE", body.RootElement.GetProperty("system").ToString());
        Assert.Equal(["Owned X"], read.Experience.Single().Highlights);
        Assert.Single(read.Education);
    }
}
