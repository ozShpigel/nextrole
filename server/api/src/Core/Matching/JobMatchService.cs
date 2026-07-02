using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Profile;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Core.Matching;

public sealed class JobMatchService : IJobMatchService
{
    private readonly IProfileProvider _profileProvider;
    private readonly IClaudeClient _claudeClient;
    private readonly ScoringConfig _scoring;
    private readonly ILogger<JobMatchService> _logger;

    public JobMatchService(
        IProfileProvider profileProvider,
        IClaudeClient claudeClient,
        ScoringConfig scoring,
        ILogger<JobMatchService> logger)
    {
        _profileProvider = profileProvider;
        _claudeClient = claudeClient;
        _scoring = scoring;
        _logger = logger;
    }

    private static string? VerdictFromScore(int? score, VerdictBands bands) => score switch
    {
        null => null,
        var s when s >= bands.StrongYes => "STRONG_YES",
        var s when s >= bands.Yes => "YES",
        var s when s >= bands.Maybe => "MAYBE",
        var s when s >= bands.No => "NO",
        _ => "STRONG_NO"
    };

    public async Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting job match analysis");

        var profile = await _profileProvider.GetProfileAsync(cancellationToken);

        var (parsedJob, analystSnap) = await ParseAsync(request, cancellationToken);
        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, request.CompanyNews, request.GlassdoorData, cancellationToken);

        var corrected = Correct(matchResponse, _scoring, ReviewCap(request.GlassdoorData?.ReviewCount)) with
        {
            JobTitle = parsedJob.JobTitle,
            Company = parsedJob.Company,
            AnalystSnapshotInput = analystSnap.Input,
            AnalystSnapshotOutput = analystSnap.Output,
            EvaluatorSnapshotInput = evalSnap.Input,
            EvaluatorSnapshotOutput = evalSnap.Output
        };
        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            corrected.Verdict, corrected.OverallScore);
        return corrected;
    }

    // Analyst pass only. Always run even when the caller pre-supplies
    // title/company — without it the Evaluator scores on vibes alone. The
    // scraper's canonical title/company override the Analyst's inference.
    public async Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseAsync(MatchRequest request, CancellationToken cancellationToken = default)
    {
        var (parsed, snap) = await _claudeClient.ParseJobDescriptionAsync(request.JobDescription, cancellationToken);
        var parsedJob = parsed with
        {
            JobTitle = !string.IsNullOrWhiteSpace(request.Title) ? request.Title! : parsed.JobTitle,
            Company = !string.IsNullOrWhiteSpace(request.Company) ? request.Company : parsed.Company,
            RawDescription = request.JobDescription
        };
        return (parsedJob, snap);
    }

    public Task<string> SubmitEvaluationBatchAsync(IReadOnlyList<EvaluationBatchItem> items, CancellationToken cancellationToken = default)
        => _claudeClient.SubmitEvaluationBatchAsync(items, cancellationToken);

    public async Task<EvaluationBatchResult> GetEvaluationBatchAsync(string batchId, CancellationToken cancellationToken = default)
    {
        var result = await _claudeClient.GetEvaluationBatchAsync(batchId, cancellationToken);
        if (!result.Ended) return result;

        // Apply the same verdict-band / shouldApply correction the live path does,
        // so batch results are identical to what AnalyzeMatchAsync would produce.
        // The original request items (and their reviewCount) aren't retained at
        // poll time, so review adjustments get the loosest cap as a backstop.
        var lines = result.Lines
            .Select(l => l.Response is null ? l : l with { Response = Correct(l.Response, _scoring, MaxReviewCap) })
            .ToList();
        return result with { Lines = lines };
    }

    // Re-derive verdict from the numeric score (authoritative bands) and recompute
    // shouldApply from the save threshold — the AI's own verdict/flag are advisory.
    private MatchResponse Correct(MatchResponse r, ScoringConfig cfg, int reviewCap)
    {
        r = EnforceReviewCaps(r, reviewCap);
        var verdict = VerdictFromScore(r.OverallScore, cfg.VerdictBands) ?? r.Verdict;
        var shouldApply = r.OverallScore >= cfg.MinScoreToSave;
        var rec = r.Recommendation is null ? null : r.Recommendation with { ShouldApply = shouldApply };
        return r with { Verdict = verdict, Recommendation = rec! };
    }

    private const int MaxReviewCap = 3;

    // Evidence-volume cap from the EMPLOYEE REVIEW EVIDENCE prompt section.
    private static int ReviewCap(int? reviewCount) => reviewCount switch
    {
        null or < 50 => 1,
        < 200 => 2,
        _ => MaxReviewCap
    };

    // Only these sub-components may be moved by employee-review evidence
    // (mirrors the prompt's mapping; Role Clarity & Technical Fit are excluded).
    private static readonly HashSet<string> ReviewEligibleComponents = new(StringComparer.OrdinalIgnoreCase)
    {
        "Engineering Maturity & Stability",
        "Pace & Workload",
        "Long-term Risk",
    };

    // The model won't reliably respect the ±cap in the prompt when review
    // evidence is extreme (verified empirically) — recompute each adjusted
    // component as base + clamped delta and rebuild the dependent sums.
    private MatchResponse EnforceReviewCaps(MatchResponse r, int cap)
    {
        var changed = false;

        ScoreComponent[] Enforce(ScoreComponent[] components)
        {
            return components.Select(c =>
            {
                if (c.ReviewAdjustment is not { Base: int baseScore } adj || c.Score is null)
                    return c;
                var max = c.MaxScore ?? int.MaxValue;
                baseScore = Math.Clamp(baseScore, 0, max);
                var delta = ReviewEligibleComponents.Contains(c.Name)
                    ? Math.Clamp(adj.Delta ?? 0, -cap, cap)
                    : 0; // review evidence may not touch this component at all
                var score = Math.Clamp(baseScore + delta, 0, max);
                if (score == c.Score) return c;
                changed = true;
                _logger.LogInformation(
                    "Review-cap enforcement: '{Component}' {Old} -> {New} (base {Base}, delta {Delta}, cap ±{Cap})",
                    c.Name, c.Score, score, baseScore, delta, cap);
                return c with { Score = score, ReviewAdjustment = adj with { Delta = delta } };
            }).ToArray();
        }

        static int? Sum(ScoreComponent[] components)
            => components.Length > 0 && components.All(c => c.Score is not null)
                ? components.Sum(c => c.Score!.Value)
                : null;

        var tech = Enforce(r.Breakdown.TechnicalFit.Components);
        var exec = Enforce(r.Breakdown.EngineeringExecutionFit.Components);
        var sust = Enforce(r.Breakdown.SustainabilityPaceFit.Components);
        if (!changed) return r;

        var breakdown = r.Breakdown with
        {
            TechnicalFit = r.Breakdown.TechnicalFit with { Components = tech, Score = Sum(tech) ?? r.Breakdown.TechnicalFit.Score },
            EngineeringExecutionFit = r.Breakdown.EngineeringExecutionFit with { Components = exec, Score = Sum(exec) ?? r.Breakdown.EngineeringExecutionFit.Score },
            SustainabilityPaceFit = r.Breakdown.SustainabilityPaceFit with { Components = sust, Score = Sum(sust) ?? r.Breakdown.SustainabilityPaceFit.Score },
        };
        var overall = breakdown.TechnicalFit.Score is int t
                   && breakdown.EngineeringExecutionFit.Score is int e
                   && breakdown.SustainabilityPaceFit.Score is int s
            ? t + e + s
            : r.OverallScore;
        return r with { Breakdown = breakdown, OverallScore = overall };
    }
}
