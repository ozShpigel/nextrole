using ApplicationTracker.Core.Greenhouse;

namespace ApplicationTracker.Infrastructure.Greenhouse;

/// <summary>
/// The candidate search when no embedding key is configured: it refuses, by name.
/// </summary>
/// <remarks>
/// <para>
/// The board repository is the only job source, so it is always registered --
/// but its candidate search embeds the profile, and embedding is a billed call
/// that needs a key. Without one (local dev, e2e) the API should still start:
/// browsing Matches reads stored postings and needs no vector, and every other
/// page is unaffected. Only a scan needs this, and a scan without a key fails
/// here with the reason, not later with an empty result that reads as "no jobs
/// like yours".
/// </para>
/// <para>
/// This replaced the old fallback, which was a second job source: with no key
/// the API read the retired LinkedIn pool instead (removed 2026-10-04).
/// </para>
/// </remarks>
public sealed class UnconfiguredCandidateJobStore : ICandidateJobStore
{
    public Task<IReadOnlyList<string>> FindCandidateJobIds(
        string renderedProfile, CandidateJobFilters filters, int n, CancellationToken ct = default) =>
        throw new InvalidOperationException(
            "Candidate search needs an embedding key: set Greenhouse:Embedding:ApiKey "
            + "(Greenhouse__Embedding__ApiKey). Without it Matches can list stored postings but cannot scan.");
}
