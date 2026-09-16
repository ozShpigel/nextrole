namespace Mailbot.Services;

/// <summary>Why a run refused to start. <see cref="PreflightCode.Proceed"/> is the only pass.</summary>
public enum PreflightCode
{
    Proceed,
    DemoMode,
    MissingToken,
    IdentityUnreadable,
    WrongAccount,
}

public sealed record PreflightVerdict(PreflightCode Code, string Message)
{
    public bool Ok => Code == PreflightCode.Proceed;
    public static readonly PreflightVerdict Pass = new(PreflightCode.Proceed, "");
}

/// <summary>
/// Decides whether this mailbot may sync at all, before a single email is read.
/// </summary>
/// <remarks>
/// Extracted from Program.cs so the decision has tests behind it. It is the
/// guard issue #67 did not have.
///
/// A Cookie-mode tracker does not reject an identity it cannot resolve — it
/// MINTS A FRESH ANONYMOUS USER and answers normally. So a mailbot with no
/// token, an expired token, or a mistyped token receives an ordinary 200
/// describing an empty account, syncs nothing, and reports success. It did
/// exactly that after the teardown: 115 applications in the database, 0 seen,
/// two throwaway users minted, {"Success":true}.
///
/// Hence the rule: a mailbot that cannot prove which account it is must not
/// run. "Reached the API" is not "reached the right account", and only the
/// second one is worth anything.
/// </remarks>
public static class TrackerPreflight
{
    /// <summary>
    /// Fixed-mode instances take identity from their own configuration, so a client
    /// presents nothing. Everything else must present a session token — including a
    /// null config, meaning an API too old to say. Assuming Fixed is the assumption
    /// that fails quietly, so it is not the default.
    /// </summary>
    public static bool RequiresSessionToken(TrackerConfig? config) =>
        !string.Equals(config?.IdentityMode, "Fixed", StringComparison.OrdinalIgnoreCase);

    /// <param name="fetchMe">
    /// Reads GET /api/auth/me as whoever this client resolves to. Called only when a
    /// token exists — there is nothing to verify otherwise, and calling it anyway
    /// would mint yet another throwaway user.
    /// </param>
    public static async Task<PreflightVerdict> EvaluateAsync(
        string trackerUrl,
        TrackerConfig? config,
        string? sessionToken,
        Func<CancellationToken, Task<TrackerIdentity?>> fetchMe,
        CancellationToken ct = default)
    {
        if (config?.DemoMode == true)
            return new(PreflightCode.DemoMode,
                $"Tracker at {trackerUrl} reports demoMode=true — its tracker is read-only, so this "
                + "sync could never write anything. Point Tracker__BaseUrl at a writable instance.");

        if (!RequiresSessionToken(config))
            return PreflightVerdict.Pass;

        if (string.IsNullOrWhiteSpace(sessionToken))
            return new(PreflightCode.MissingToken,
                $"Tracker at {trackerUrl} resolves identity from a session cookie, and no "
                + "Tracker__SessionToken is configured. Without one this sync reads an empty account "
                + "and writes nothing, while reporting success. Run deploy/mint-mailbot-session.sh.");

        var me = await fetchMe(ct);

        // Null is transport failure, not "signed out". Aborting here is stricter
        // than the old behaviour, which let a run start and fail later with
        // transport errors — deliberately, because "start and fail" is how a
        // partial sync happens, and systemd sees a clean failure either way.
        if (me is null)
            return new(PreflightCode.IdentityUnreadable,
                $"Could not reach {trackerUrl}/api/auth/me to confirm which account this token "
                + "resolves to. Aborting rather than syncing as an unknown user.");

        if (!me.SignedIn)
            return new(PreflightCode.WrongAccount,
                "The configured Tracker__SessionToken resolves to an account with no Google link — "
                + "almost certainly expired, revoked, or mistyped, in which case the API has just "
                + "minted a throwaway anonymous user for this request. "
                + "Re-run deploy/mint-mailbot-session.sh.");

        return PreflightVerdict.Pass;
    }
}
