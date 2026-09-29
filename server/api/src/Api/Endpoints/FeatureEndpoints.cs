using ApplicationTracker.Api.Features;
using ApplicationTracker.Core.Identity;

namespace ApplicationTracker.Api.Endpoints;

public static class FeatureEndpoints
{
    public static WebApplication MapFeatureEndpoints(this WebApplication app)
    {
        // Which gated features the current user may use: { "AutoUpdate": true, ... }.
        // The client renders a locked control for every false.
        app.MapGet("/api/features", async (IUserContext user, IFeatureAccess access) =>
            Results.Ok(await ForUserAsync(access, user.UserId)))
        .WithName("GetFeatures")
        .WithSummary("Which gated features the current user may use");

        return app;
    }

    /// <summary>Every known feature, and whether this user may use it.</summary>
    public static async Task<Dictionary<string, bool>> ForUserAsync(IFeatureAccess access, Guid userId)
    {
        var result = new Dictionary<string, bool>();
        foreach (var feature in FeatureNames.All)
            result[feature] = await access.CanUseAsync(feature, userId);
        return result;
    }
}
