using System.Text.Json;
using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Matching;

/// <summary>
/// Turning a pool job plus this user's score into the application they are
/// adding to their tracker.
/// </summary>
/// <remarks>
/// A pure function, separate from the endpoint, because the join it performs
/// has already gone wrong once and is worth pinning.
///
/// Scoring moved off ingest when the pool became shared, so
/// <c>discovered_jobs.score</c> / <c>.verdict</c> / <c>.match_analysis</c> are
/// permanently null on every job either ingest path writes. The old save read
/// them anyway, so every "Add" from Matches created an application with no
/// score, no verdict and no analysis: the user saw 92/STRONG_YES on the card,
/// clicked Add, and the tracked row had nothing. Silent, because a null score
/// renders as an absent section rather than an error — and because the money
/// had already been spent producing the value being discarded.
///
/// The score comes from <see cref="JobScore"/> and from nowhere else. A pool
/// document that still carries ingest-era fields is not consulted.
/// </remarks>
public static class PoolJobApplication
{
    public static Application ToApplication(
        Guid userId, PoolJob job, JobScore? score, string? resolvedCompanyLogo)
    {
        return new Application
        {
            UserId = userId,
            JobTitle = job.Title,
            Company = job.Company,
            Status = ApplicationStatus.DecidedToApply,
            JobDescription = job.Description ?? "",
            JobUrl = job.JobUrl,

            // This user's row, never the pool document.
            MatchScore = score?.Score,
            MatchVerdict = score?.Verdict,
            // Already a JSON string on JobScore, unlike the BSON document the
            // pool used to hold. Serializing it again would store a quoted blob
            // the client cannot parse.
            MatchAnalysis = score?.MatchAnalysis,

            // The four raw Claude call snapshots are deliberately absent. They
            // were written by ingest-time scoring, which no longer exists, and
            // JobScore has no field for them — passing them through only made
            // four always-null arguments look like real ones.

            CompanyNews = job.CompanyNews is { Count: > 0 }
                ? JsonSerializer.Serialize(job.CompanyNews)
                : null,
            GlassdoorData = job.GlassdoorData is not null
                ? JsonSerializer.Serialize(job.GlassdoorData)
                : null,

            // A company's logo does not change between postings, so a job whose
            // own scrape missed one borrows from another rather than saving a
            // permanently blank row.
            CompanyLogo = job.CompanyLogo ?? resolvedCompanyLogo,
        };
    }
}
