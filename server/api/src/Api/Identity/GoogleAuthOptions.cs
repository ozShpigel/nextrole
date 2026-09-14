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

    public bool Enabled =>
        !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);

    public bool TryGetClaimUserId(out Guid userId) =>
        Guid.TryParse(ClaimUserId, out userId) && userId != Guid.Empty;
}
