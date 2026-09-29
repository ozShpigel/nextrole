using ApplicationTracker.Api.Endpoints;
using ApplicationTracker.Api.Features;
using ApplicationTracker.Core.Identity;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ArchitectureTests;

/// <summary>
/// Coming-soon gating (docs/plans/feature-gating.md): a feature that is not
/// free is open only to its allowlist, and the gate is enforced server-side on
/// every route of the gated features.
/// </summary>
public class FeatureGatingTests
{
    private static readonly Guid Owner = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Visitor = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private sealed class Monitor(FeatureOptions value) : IOptionsMonitor<FeatureOptions>
    {
        public FeatureOptions CurrentValue => value;
        public FeatureOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<FeatureOptions, string?> listener) => null;
    }

    private sealed class FixedUser(Guid id) : IUserContext
    {
        public Guid UserId => id;
    }

    private static ConfigFeatureAccess Access(FeatureOptions options) => new(new Monitor(options));

    private static FeatureOptions Options() => new()
    {
        Status =
        {
            [FeatureNames.AutoUpdate] = FeatureStatus.ComingSoon,
            [FeatureNames.AutoApply] = FeatureStatus.ComingSoon,
            [FeatureNames.PracticeInterview] = FeatureStatus.ComingSoon,
            [FeatureNames.InterviewInsights] = FeatureStatus.Free,
        },
        AllowedUsers =
        {
            [FeatureNames.AutoUpdate] = [Owner],
            [FeatureNames.PracticeInterview] = [Owner],
        },
    };

    // ── The rule ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_free_feature_is_open_to_everyone() =>
        Assert.True(await Access(Options()).CanUseAsync(FeatureNames.InterviewInsights, Visitor));

    [Fact]
    public async Task A_coming_soon_feature_is_open_to_its_allowlist() =>
        Assert.True(await Access(Options()).CanUseAsync(FeatureNames.AutoUpdate, Owner));

    [Fact]
    public async Task A_coming_soon_feature_is_closed_to_everyone_else() =>
        Assert.False(await Access(Options()).CanUseAsync(FeatureNames.AutoUpdate, Visitor));

    [Fact]
    public async Task Being_on_another_features_list_opens_nothing_else() =>
        // The owner is allowed AutoUpdate and PracticeInterview, not AutoApply.
        Assert.False(await Access(Options()).CanUseAsync(FeatureNames.AutoApply, Owner));

    [Fact]
    public async Task A_feature_missing_from_config_is_locked()
    {
        // FeatureStatus's default is Free: a lookup that fell back to the
        // default would open every feature nobody configured.
        var access = Access(new FeatureOptions());
        Assert.False(await access.CanUseAsync(FeatureNames.PracticeInterview, Owner));
        Assert.False(await access.CanUseAsync("NoSuchFeature", Owner));
    }

    [Fact]
    public async Task The_response_lists_every_feature_for_the_caller()
    {
        var access = Access(Options());

        Assert.Equal(
            new Dictionary<string, bool>
            {
                [FeatureNames.AutoUpdate] = true, [FeatureNames.AutoApply] = false,
                [FeatureNames.PracticeInterview] = true, [FeatureNames.InterviewInsights] = true,
            },
            await FeatureEndpoints.ForUserAsync(access, Owner));
        Assert.Equal(
            new Dictionary<string, bool>
            {
                [FeatureNames.AutoUpdate] = false, [FeatureNames.AutoApply] = false,
                [FeatureNames.PracticeInterview] = false, [FeatureNames.InterviewInsights] = true,
            },
            await FeatureEndpoints.ForUserAsync(access, Visitor));
    }

    // ── Configuration ────────────────────────────────────────────────────────

    private static FeatureOptions Bind(Dictionary<string, string?> settings)
    {
        var options = new FeatureOptions();
        new ConfigurationBuilder().AddInMemoryCollection(settings).Build()
            .GetSection(FeatureOptions.SectionName).Bind(options);
        return options;
    }

    [Fact]
    public async Task An_allowlist_set_per_deploy_binds_whatever_the_key_case()
    {
        // How production sets the owner: Features__AllowedUsers__AutoUpdate__0.
        // Configuration keys are case-insensitive, so the lookup must be too.
        var options = Bind(new()
        {
            ["Features:Status:AutoUpdate"] = "ComingSoon",
            ["Features:AllowedUsers:autoupdate:0"] = Owner.ToString(),
        });

        Assert.Null(options.Problem());
        Assert.True(await Access(options).CanUseAsync(FeatureNames.AutoUpdate, Owner));
    }

    [Fact]
    public void A_misspelt_feature_name_is_a_startup_error_not_a_silent_lock()
    {
        var options = Bind(new() { ["Features:AllowedUsers:AutoUpdates:0"] = Owner.ToString() });

        var problem = options.Problem();
        Assert.NotNull(problem);
        Assert.Contains("AutoUpdates", problem);
    }

    [Fact]
    public void The_shipped_configuration_names_only_known_features()
    {
        var settings = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(RepoSources.Root, "server", "api", "src", "Api", "appsettings.json"))
            .Build();
        var options = new FeatureOptions();
        settings.GetSection(FeatureOptions.SectionName).Bind(options);

        Assert.Null(options.Problem());
        Assert.Equal(FeatureStatus.ComingSoon, options.Status[FeatureNames.AutoUpdate]);
        // Locked since the locked UI shipped with it (Part 2); the owner keeps it.
        Assert.Equal(FeatureStatus.ComingSoon, options.Status[FeatureNames.PracticeInterview]);
        Assert.Contains(Owner, options.AllowedUsers[FeatureNames.PracticeInterview]);
    }

    // ── The gate ─────────────────────────────────────────────────────────────

    private static async Task<object?> Through(FeatureGateFilter filter, Guid user)
    {
        var services = new ServiceCollection()
            .AddSingleton<IUserContext>(new FixedUser(user))
            .AddSingleton<IFeatureAccess>(Access(Options()))
            .BuildServiceProvider();
        var context = EndpointFilterInvocationContext.Create(new DefaultHttpContext { RequestServices = services });
        return await filter.InvokeAsync(context, _ => ValueTask.FromResult<object?>("handled"));
    }

    [Fact]
    public async Task The_gate_refuses_a_user_who_may_not_use_the_feature_with_403()
    {
        var result = await Through(new FeatureGateFilter(FeatureNames.PracticeInterview), Visitor);

        var status = Assert.IsAssignableFrom<IStatusCodeHttpResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, status.StatusCode);
    }

    [Fact]
    public async Task The_gate_passes_a_user_who_may() =>
        Assert.Equal("handled", await Through(new FeatureGateFilter(FeatureNames.PracticeInterview), Owner));

    [Fact]
    public void Gating_on_an_unknown_feature_fails_where_it_is_written()
    {
        var builder = WebApplication.CreateBuilder();
        var app = builder.Build();
        Assert.Throws<ArgumentException>(() => app.MapGroup("/x").RequireFeature("NoSuchFeature"));
    }

    // ── Every gated route is gated ───────────────────────────────────────────
    //
    // Structural, like UserScopedCollection: the gated features' routes are
    // mapped only through a group that carries the gate, so a route added
    // later is gated without anyone remembering to. A route mapped straight on
    // `app` in these files would slip past it, and fails here.

    private static string Endpoints(string file) =>
        File.ReadAllText(Path.Combine(RepoSources.Root, "server", "api", "src", "Api", "Endpoints", file));

    [Theory]
    [InlineData("MockInterviewEndpoints.cs", "/api/mock-interview", nameof(FeatureNames.PracticeInterview))]
    [InlineData("InterviewInsightsEndpoints.cs", "/api/interview-insights", nameof(FeatureNames.InterviewInsights))]
    public void A_gated_features_routes_are_mapped_only_through_its_gated_group(string file, string prefix, string feature)
    {
        var source = Endpoints(file);

        Assert.Contains($"app.MapGroup(\"{prefix}\").RequireFeature(FeatureNames.{feature})", source);
        Assert.DoesNotMatch(@"app\.Map(Get|Post|Put|Delete|Patch|Methods)\(", source);
    }

    [Fact]
    public void The_mailbots_email_read_is_gated_on_auto_update() =>
        Assert.Contains(".RequireFeature(FeatureNames.AutoUpdate)", Endpoints("EmailParseEndpoints.cs"));
}
