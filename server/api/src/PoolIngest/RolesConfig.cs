using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace ApplicationTracker.PoolIngest;

/// <summary>
/// The shared pool's role list, loaded from a config file rather than code.
/// </summary>
/// <remarks>
/// A new role should be a one-line edit plus a redeploy of the file, not a code
/// change. Nothing here depends on any user: the pool is common to everyone.
///
/// Ported from the scraper's <c>app/roles.py</c>. The file format is unchanged,
/// so <c>config/roles.json</c> is read by whichever service is running the
/// ingest — deliberately, so the migration does not need a config change too.
/// </remarks>
public sealed record RolesConfig
{
    [JsonPropertyName("roles")] public List<string> Roles { get; init; } = [];
    [JsonPropertyName("locations")] public List<string> Locations { get; init; } = ["Israel"];
    [JsonPropertyName("site_names")] public List<string> SiteNames { get; init; } = ["linkedin"];
    [JsonPropertyName("results_wanted")] public int ResultsWanted { get; init; } = 50;
    [JsonPropertyName("hours_old")] public int HoursOld { get; init; } = 72;
    [JsonPropertyName("country")] public string Country { get; init; } = "Israel";

    /// <summary>
    /// A listing absent from this many consecutive runs is marked inactive.
    /// Not 1: a single scrape missing a job is routine — rate limiting, a flaky
    /// detail fetch, a board reshuffling its result page — and flipping a live
    /// posting to inactive on one bad run is worse than noticing a day late.
    /// </summary>
    [JsonPropertyName("missed_runs_before_inactive")]
    public int MissedRunsBeforeInactive { get; init; } = 3;

    /// <summary>
    /// Ceiling on how many roles the daily run searches, baseline included.
    /// Every role is titles x locations more scraping, so one unusual CV must
    /// not be able to grow the run without limit.
    /// </summary>
    [JsonPropertyName("max_roles")] public int MaxRoles { get; init; } = 12;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>
    /// Read and validate the role config.
    /// </summary>
    /// <remarks>
    /// Throws rather than falling back to a hardcoded list: a daily run against
    /// a silently-defaulted role set would quietly ingest the wrong pool for as
    /// long as nobody noticed.
    /// </remarks>
    public static RolesConfig Load(string path, ILogger logger)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"Roles config not found at {path}. Set ROLES_CONFIG_PATH or restore the file.");

        var config = JsonSerializer.Deserialize<RolesConfig>(File.ReadAllText(path), Json)
            ?? throw new InvalidOperationException($"Roles config at {path} did not parse.");

        var roles = config.Roles
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .ToList();

        if (roles.Count == 0)
            throw new InvalidOperationException($"Roles config at {path} lists no roles.");

        // De-dupe case-insensitively but keep the file's own casing and order,
        // so the searches run in the order a human wrote them.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var unique = new List<string>();
        foreach (var role in roles)
        {
            if (!seen.Add(role))
            {
                logger.LogWarning("Roles config lists {Role} more than once; ignoring the duplicate", role);
                continue;
            }
            unique.Add(role);
        }

        return config with { Roles = unique };
    }
}

/// <summary>
/// The roles this run will actually search: the config baseline, plus the roles
/// users have grown the pool with, capped.
/// </summary>
/// <remarks>
/// Two halves on purpose. The baseline lives in a file because it is a human
/// decision that should survive every deploy and every user coming and going.
/// The grown half lives in Mongo because the app writes it — a file the app
/// edits would be lost on the next container restart.
///
/// The cap is applied here rather than at write time because this is where the
/// cost is: a role is titles x locations of extra scraping per day. Baseline
/// roles are never cut; grown roles compete for what is left, most-needed
/// first, then oldest — so the cap behaves like a queue rather than a race.
/// </remarks>
public sealed class EffectiveRoles
{
    private readonly IMongoCollection<BsonDocument> _poolRoles;
    private readonly ILogger<EffectiveRoles> _log;

    public EffectiveRoles(IMongoCollection<BsonDocument> poolRoles, ILogger<EffectiveRoles> log)
    {
        _poolRoles = poolRoles;
        _log = log;
    }

    /// <summary>
    /// Mirror the config file's baseline roles into <c>pool_roles</c>.
    /// </summary>
    /// <remarks>
    /// The API classifies a new CV against "roles already being searched", and
    /// it reads that list from <c>pool_roles</c> — it has no access to this
    /// file. Without the baseline in there, a backend engineer would be
    /// classified against an empty list and could be filed under an invented
    /// "Backend Developer" while "Backend Engineer" was already running:
    /// exactly the fragmentation the role cap makes expensive.
    ///
    /// The file stays authoritative for what actually gets searched — see
    /// <see cref="ResolveAsync"/>, which reads it directly — so an edit takes
    /// effect on the next run whether or not this mirror is current.
    ///
    /// Ported in Phase 3d of docs/scraper-slimming.md. It ran in the scraper's
    /// lifespan until then, and Phase 2 moved the ingest without it: the mirror
    /// kept working only because that service happened to still be starting up
    /// next to it.
    /// </remarks>
    public async Task PublishBaselineAsync(RolesConfig config, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var keys = config.Roles.Select(r => r.ToLowerInvariant()).ToList();

        try
        {
            foreach (var (role, key) in config.Roles.Zip(keys))
            {
                await _poolRoles.UpdateOneAsync(
                    Builders<BsonDocument>.Filter.Eq("_id", key),
                    Builders<BsonDocument>.Update
                        .Set("Role", role)
                        .Set("Baseline", true)
                        .Set("UpdatedAt", now)
                        .SetOnInsert("UserIds", new BsonArray())
                        .SetOnInsert("CreatedAt", now),
                    new UpdateOptions { IsUpsert = true }, ct);
            }

            // A role removed from the file stops being baseline. It is NOT
            // deleted: users may still be filed under it, and that is what
            // decides whether it keeps being searched.
            await _poolRoles.UpdateManyAsync(
                Builders<BsonDocument>.Filter.And(
                    Builders<BsonDocument>.Filter.Eq("Baseline", true),
                    Builders<BsonDocument>.Filter.Nin("_id", keys.Select(k => (BsonValue)k))),
                Builders<BsonDocument>.Update.Unset("Baseline"),
                cancellationToken: ct);
        }
        catch (Exception e)
        {
            // Not fatal. The run searches the file's roles regardless; what
            // degrades is the API's view of "already being searched", which
            // costs role fragmentation rather than a failed ingest.
            _log.LogError(e, "Could not publish the baseline role list; CV classification may fragment roles");
        }
    }

    public async Task<List<string>> ResolveAsync(RolesConfig config, CancellationToken ct = default)
    {
        var baseline = new List<string>(config.Roles);
        var seen = new HashSet<string>(baseline, StringComparer.OrdinalIgnoreCase);
        var room = config.MaxRoles - baseline.Count;

        List<BsonDocument> grown;
        try
        {
            grown = await _poolRoles
                .Find(Builders<BsonDocument>.Filter.Ne("Baseline", true))
                .ToListAsync(ct);
        }
        catch (Exception e)
        {
            // The baseline alone is a correct, useful run. Refusing to scrape
            // at all because the grown half is unreadable is the worse failure.
            _log.LogError(e, "Could not read pool_roles; running the baseline roles only");
            return baseline;
        }

        grown.Sort((a, b) =>
        {
            var byNeed = UserCount(b).CompareTo(UserCount(a));
            return byNeed != 0 ? byNeed : string.CompareOrdinal(CreatedAt(a), CreatedAt(b));
        });

        List<string> admitted = [], refused = [];
        foreach (var doc in grown)
        {
            var role = (doc.TryGetValue("Role", out var r) && r.IsString ? r.AsString : "").Trim();
            if (role.Length == 0 || !seen.Add(role)) continue;
            (admitted.Count < room ? admitted : refused).Add(role);
        }

        if (refused.Count > 0)
            _log.LogWarning(
                "Role cap reached (max_roles={Max}): searching {Admitted} user-grown role(s), "
                + "holding back {Refused} — {Names}. Raise max_roles if the pool should cover them.",
                config.MaxRoles, admitted.Count, refused.Count, string.Join(", ", refused));

        if (admitted.Count > 0)
            _log.LogInformation("Daily run roles: {Baseline} baseline + {Grown} user-grown",
                baseline.Count, admitted.Count);

        return [.. baseline, .. admitted];
    }

    private static int UserCount(BsonDocument d) =>
        d.TryGetValue("UserIds", out var v) && v.IsBsonArray ? v.AsBsonArray.Count : 0;

    private static string CreatedAt(BsonDocument d) =>
        d.TryGetValue("CreatedAt", out var v) && v.IsValidDateTime
            ? v.ToUniversalTime().ToString("o")
            : "";
}
