using System.Globalization;

namespace ApplicationTracker.Api.Identity;

public sealed class GoogleAuthOptions
{
    public const string SectionName = "Google";

    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }

    // Where Google sends the user back. Must match an Authorized redirect URI
    // on the OAuth client exactly, including scheme, port and path.
    public string RedirectUri { get; set; } = "http://localhost:5002/api/auth/google/callback";

    // Where the browser lands after the callback. "/" is correct in production,
    // where nginx serves client and API on one origin. In local dev the API is
    // on :5002 and the client on :5173, so this needs the client's origin — the
    // uid cookie still arrives, because cookies are scoped by host and ignore
    // the port.
    public string PostSignInRedirect { get; set; } = "/";

    // ONE-SHOT MIGRATION HATCH (docs/auth.md).
    //
    // The pre-auth data on this instance belongs to a userId nobody can prove
    // they own, because there was never a login. This names that userId: the
    // first Google account to sign in adopts it instead of the empty account
    // their cookie just minted.
    //
    // Setting this back does NOT re-arm it. The claim is gated on there being
    // no GoogleIdentity document for the target, so the moment the claim
    // succeeds the branch is dead in code whatever the config says — see
    // GoogleSignInResolver. That is deliberate: on a public instance this is
    // the switch that would otherwise hand an entire job history to whoever
    // signs in next.
    public string? ClaimUserId { get; set; }

    // WHO the claim is for. Required whenever ClaimUserId is set.
    //
    // Without this the claim goes to whoever signs in first, which on a public
    // instance means a stranger can take an entire job history by being quick.
    // Pinning it to a Google-verified address makes a forgotten ClaimUserId
    // inert to everyone except the person named here: the value stops being a
    // live grenade and becomes a no-op.
    public string? ClaimEmail { get; set; }

    // WHEN the claim stops existing. Required whenever the other two are set.
    //
    // The pin makes a forgotten ClaimUserId harmless; this makes it temporary.
    // An absolute UTC instant, because the alternative — a guard that reads
    // whether the target is already linked — depends on database state and
    // would silently re-arm if that link were ever deleted (account deletion is
    // an open question in docs/auth.md). A date cannot be un-passed by anything
    // happening in the database.
    //
    // Accepted: yyyy-MM-dd, yyyy-MM-ddTHH:mm:ss, yyyy-MM-ddTHH:mm:ssZ. Always
    // UTC — a bare date means midnight UTC, not midnight wherever the server
    // happens to be.
    public string? ClaimExpiresAt { get; set; }

    public bool Enabled =>
        !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);

    /// <summary>
    /// Both halves of the claim, or nothing. There is no arming without a named
    /// recipient.
    /// </summary>
    private static readonly string[] ExpiryFormats =
    [
        "yyyy-MM-dd",
        "yyyy-MM-ddTHH:mm:ss",
        "yyyy-MM-ddTHH:mm:ssZ",
        "yyyy-MM-ddTHH:mm:ssK",
    ];

    /// <summary>
    /// Parses the expiry strictly, as UTC.
    /// </summary>
    /// <remarks>
    /// Exact formats and InvariantCulture on purpose. A lenient parse would
    /// read "03/04/2026" differently depending on the host's locale, and the
    /// value decides when an account takeover window closes. AssumeUniversal
    /// means a value without an offset is UTC rather than server-local, so the
    /// same config expires at the same instant wherever it runs.
    /// </remarks>
    public bool TryGetClaimExpiry(out DateTime utcExpiry) =>
        DateTime.TryParseExact(
            (ClaimExpiresAt ?? string.Empty).Trim(),
            ExpiryFormats,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out utcExpiry);

    /// <summary>
    /// All three parts of the claim, or nothing. There is no arming without a
    /// named recipient and a deadline.
    /// </summary>
    /// <remarks>
    /// Expiry is re-checked here, not only at startup: a process that booted
    /// before the deadline would otherwise keep the claim armed for as long as
    /// it happens to stay up, which on a container that is not redeployed for
    /// months is exactly the situation the deadline exists to end.
    /// </remarks>
    public bool TryGetClaim(DateTime utcNow, out Guid userId, out string email)
    {
        email = (ClaimEmail ?? string.Empty).Trim();
        var ok = Guid.TryParse(ClaimUserId, out userId)
                 && userId != Guid.Empty
                 && email.Length > 0
                 && TryGetClaimExpiry(out var expiry)
                 && utcNow < expiry;

        if (!ok) { userId = Guid.Empty; email = string.Empty; }
        return ok;
    }

    /// <summary>
    /// Fails startup when the claim is half-configured.
    /// </summary>
    /// <remarks>
    /// Startup, not a warning, and not a silent ignore. ClaimUserId alone is
    /// the dangerous half — it arms the claim for an arbitrary signer — and
    /// ClaimEmail alone means somebody intended a claim that will never fire
    /// and may quietly conclude the feature is broken. Both are configuration
    /// mistakes best discovered by a process that refuses to run, the same way
    /// IdentityResolver treats a Fixed instance with no FixedUserId.
    ///
    /// NOTE: a ClaimUserId that is set but unparseable still fails safe rather
    /// than loudly — TryGetClaim returns false and the claim never arms. That
    /// is a gap, but it errs towards not handing an account to anybody.
    /// </remarks>
    public void Validate(DateTime? utcNow = null)
    {
        var parts = new (string Key, bool Set)[]
        {
            ("Google:ClaimUserId", !string.IsNullOrWhiteSpace(ClaimUserId)),
            ("Google:ClaimEmail", !string.IsNullOrWhiteSpace(ClaimEmail)),
            ("Google:ClaimExpiresAt", !string.IsNullOrWhiteSpace(ClaimExpiresAt)),
        };

        var set = parts.Where(p => p.Set).Select(p => p.Key).ToArray();
        var missing = parts.Where(p => !p.Set).Select(p => p.Key).ToArray();

        if (set.Length == 0) return;   // no claim configured at all

        if (missing.Length > 0)
            throw new InvalidOperationException(
                $"The one-shot claim is half-configured: {string.Join(", ", set)} "
                + $"set, {string.Join(", ", missing)} missing. All three are required. "
                + "ClaimUserId names the account to hand over, ClaimEmail names the only Google "
                + "account allowed to take it — without it the account goes to whoever signs in "
                + "first — and ClaimExpiresAt is when the offer stops existing.");

        if (!TryGetClaimExpiry(out var expiry))
            throw new InvalidOperationException(
                $"Google:ClaimExpiresAt is '{ClaimExpiresAt}', which is not a valid UTC timestamp. "
                + "Expected yyyy-MM-dd or yyyy-MM-ddTHH:mm:ssZ. Refusing to start rather than "
                + "guessing, because this value decides when an account-takeover window closes.");

        var now = utcNow ?? DateTime.UtcNow;
        if (now >= expiry)
            throw new InvalidOperationException(
                $"Google:ClaimExpiresAt was {expiry:yyyy-MM-dd HH:mm:ss}Z and it is now "
                + $"{now:yyyy-MM-dd HH:mm:ss}Z. The claim has expired: remove Google:ClaimUserId, "
                + "Google:ClaimEmail and Google:ClaimExpiresAt. They have done their job, and "
                + "leaving them is how a migration hatch becomes permanent.");
    }
}
