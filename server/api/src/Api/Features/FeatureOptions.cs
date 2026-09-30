namespace ApplicationTracker.Api.Features;

// Coming-soon feature gating (docs/plans/feature-gating.md): some features are
// visible but locked, enforced here, with an allowlist per feature. Read-only
// server configuration like scoring_config -- a change is a config change and
// a restart, never a code change.

public enum FeatureStatus
{
    Free,
    ComingSoon,
    Paid,
}

/// <summary>The gated features. Constants, so a misspelt name is a compile error rather than a silent lock.</summary>
public static class FeatureNames
{
    public const string AutoUpdate = "AutoUpdate";
    public const string AutoApply = "AutoApply";
    public const string PracticeInterview = "PracticeInterview";
    public const string InterviewInsights = "InterviewInsights";
    // Adding a job by pasting its URL (the Active page's "Import job").
    public const string ImportJob = "ImportJob";

    public static readonly IReadOnlyList<string> All = [AutoUpdate, AutoApply, PracticeInterview, InterviewInsights, ImportJob];
}

public sealed class FeatureOptions
{
    public const string SectionName = "Features";

    // Case-insensitive, like configuration keys themselves: an environment
    // variable written Features__AllowedUsers__autoupdate__0 must still land on
    // AutoUpdate, not on a key nothing reads.
    public Dictionary<string, FeatureStatus> Status { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, Guid[]> AllowedUsers { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Every configured name is a known feature, or null; otherwise what is wrong.</summary>
    /// <remarks>
    /// A misspelt key is not harmless: under AllowedUsers it silently locks the
    /// owner out of a feature, under Status it leaves the feature locked. So it
    /// fails at startup, like a misconfigured identity mode.
    /// </remarks>
    public string? Problem()
    {
        var unknown = Status.Keys.Concat(AllowedUsers.Keys)
            .Where(k => !FeatureNames.All.Contains(k, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return unknown.Count == 0
            ? null
            : $"Features: unknown feature name(s) {string.Join(", ", unknown)}. Known: {string.Join(", ", FeatureNames.All)}.";
    }
}
