using ApplicationTracker.Core.Identity;

namespace ApplicationTracker.Api.Features;

/// <summary>Refuses a request with 403 when its user may not use the feature.</summary>
/// <remarks>
/// Asks who the user is, so an unresolvable service credential is refused
/// with 401 by the identity middleware before any feature check -- never
/// answered as a fresh account (AGENTS.md).
/// </remarks>
public sealed class FeatureGateFilter(string feature) : IEndpointFilter
{
    public string Feature { get; } = feature;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var services = context.HttpContext.RequestServices;
        var user = services.GetRequiredService<IUserContext>();
        var access = services.GetRequiredService<IFeatureAccess>();

        if (!await access.CanUseAsync(Feature, user.UserId))
            return Results.Json(new { error = $"{Feature} is not available yet.", feature = Feature },
                statusCode: StatusCodes.Status403Forbidden);

        return await next(context);
    }
}

public static class FeatureGateExtensions
{
    /// <summary>Gate an endpoint, or every endpoint in a group, behind a feature.</summary>
    public static TBuilder RequireFeature<TBuilder>(this TBuilder builder, string feature)
        where TBuilder : IEndpointConventionBuilder
    {
        if (!FeatureNames.All.Contains(feature))
            throw new ArgumentException($"'{feature}' is not a known feature.", nameof(feature));
        return builder.AddEndpointFilter(new FeatureGateFilter(feature));
    }
}
