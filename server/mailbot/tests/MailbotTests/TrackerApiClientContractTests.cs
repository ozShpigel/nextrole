using System.Net;
using System.Text;
using Mailbot.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace MailbotTests;

/// <summary>
/// The JSON the API actually sends must populate the fields the preflight reads.
/// </summary>
/// <remarks>
/// TrackerPreflightTests construct TrackerConfig in memory, so every one of them
/// would still pass if `identityMode` never deserialized — the guard would then
/// see null, treat it as Cookie, and refuse every run for the wrong reason. An
/// instrument that cannot see the change is worse than no instrument (AGENTS.md,
/// Testing). These drive the deserialization instead, against the exact payload
/// shape Program.cs and AuthEndpoints.cs emit.
/// </remarks>
public class TrackerApiClientContractTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly string _json;
        public HttpRequestMessage? LastRequest { get; private set; }
        public StubHandler(string json) => _json = json;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastRequest = request;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_json, Encoding.UTF8, "application/json"),
            });
        }
    }

    private static (TrackerApiClient client, StubHandler handler) Build(string json)
    {
        var handler = new StubHandler(json);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://api:8080") };
        return (new TrackerApiClient(http, NullLogger<TrackerApiClient>.Instance), handler);
    }

    [Fact]
    public async Task Config_DeserializesIdentityMode()
    {
        // Exactly what Program.cs's /api/config returns.
        var (client, _) = Build("""{"identityMode":"Cookie"}""");

        var config = await client.GetConfigAsync();

        Assert.NotNull(config);
        Assert.Equal("Cookie", config!.IdentityMode);
        Assert.True(TrackerPreflight.RequiresSessionToken(config));
    }

    [Fact]
    public async Task Config_FromFixedInstance_NeedsNoToken()
    {
        var (client, _) = Build("""{"identityMode":"Fixed"}""");

        Assert.False(TrackerPreflight.RequiresSessionToken(await client.GetConfigAsync()));
    }

    [Fact]
    public async Task Config_FromAnOlderApi_StillParses_AndRequiresAToken()
    {
        // An API deployed before identityMode existed. The field is absent, not
        // null-valued — the deserializer must not choke, and the guard must
        // stay strict rather than defaulting to Fixed.
        var (client, _) = Build("{}");

        var config = await client.GetConfigAsync();

        Assert.NotNull(config);
        Assert.Null(config!.IdentityMode);
        Assert.True(TrackerPreflight.RequiresSessionToken(config));
    }

    [Fact]
    public async Task Me_DeserializesSignedIn()
    {
        // Exactly what AuthEndpoints.cs's /api/auth/me returns.
        var (client, handler) = Build("""{"signedIn":true,"email":"someone@example.com","available":true}""");

        var me = await client.GetMeAsync();

        Assert.NotNull(me);
        Assert.True(me!.SignedIn);
        Assert.Equal("someone@example.com", me.Email);
        Assert.Equal("/api/auth/me", handler.LastRequest?.RequestUri?.AbsolutePath);
    }

    [Fact]
    public async Task Me_FromAnAnonymousCaller_ReportsNotSignedIn()
    {
        // The production failure, on the wire: a 200 describing nobody.
        var (client, _) = Build("""{"signedIn":false,"email":null,"available":true}""");

        var me = await client.GetMeAsync();

        Assert.NotNull(me);
        Assert.False(me!.SignedIn);
    }
}
