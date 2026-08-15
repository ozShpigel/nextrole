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
        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, request.CompanyNews, request.GlassdoorData, request.CompanyProfile, cancellationToken);

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

    public async Task<MatchBatchResponse> AnalyzeMatchBatchAsync(MatchBatchRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting batch job match analysis ({Count} jobs)", request.Jobs.Count);

        var profile = await _profileProvider.GetProfileAsync(cancellationToken);

        // Analyst pass: ONE shared call parses every job in the batch — same
        // shared-system-prompt-cost saving the Evaluator batch call already
        // gets. Title/Company caller overrides are applied here, after
        // parsing, same as the single-job path (ParseAsync) — never sent to
        // the model itself.
        var (parseResults, analystSnap) = await _claudeClient.ParseJobDescriptionBatchAsync(request.Jobs, cancellationToken);
        var parsedById = parseResults.ToDictionary(r => r.Id, r => r.Parsed);

        var parsed = request.Jobs.Select(item =>
        {
            var parsedJob = parsedById[item.Id] with
            {
                JobTitle = !string.IsNullOrWhiteSpace(item.Title) ? item.Title! : parsedById[item.Id].JobTitle,
                Company = !string.IsNullOrWhiteSpace(item.Company) ? item.Company : parsedById[item.Id].Company,
            };
            return (Item: item, ParsedJob: parsedJob);
        }).ToList();

        var evaluationItems = parsed.Select(p => new EvaluationBatchItem
        {
            Id = p.Item.Id,
            ParsedJob = p.ParsedJob,
            CompanyNews = p.Item.CompanyNews,
            GlassdoorData = p.Item.GlassdoorData,
            CompanyProfile = p.Item.CompanyProfile,
        }).ToList();

        var (batchResults, evalSnap) = await _claudeClient.EvaluateMatchBatchAsync(profile, evaluationItems, cancellationToken);
        var responseById = batchResults.ToDictionary(r => r.Id, r => r.Response);

        var results = parsed.Select(p =>
        {
            var raw = responseById[p.Item.Id];
            var corrected = Correct(raw, _scoring, ReviewCap(p.Item.GlassdoorData?.ReviewCount)) with
            {
                JobTitle = p.ParsedJob.JobTitle,
                Company = p.ParsedJob.Company,
                // The whole batch shares one Analyst call and one Evaluator
                // call — every job's snapshots are the same shared
                // request/response, honestly reflecting that this job wasn't
                // parsed or scored in isolation.
                AnalystSnapshotInput = analystSnap.Input,
                AnalystSnapshotOutput = analystSnap.Output,
                EvaluatorSnapshotInput = evalSnap.Input,
                EvaluatorSnapshotOutput = evalSnap.Output,
            };
            return new MatchBatchResult { Id = p.Item.Id, Response = corrected };
        }).ToList();

        _logger.LogInformation("Batch job match analysis completed: {Count} jobs", results.Count);
        return new MatchBatchResponse { Results = results };
    }

    // Analyst pass only. Always run even when the caller pre-supplies
    // title/company — without it the Evaluator scores on vibes alone. The
    // caller's canonical title/company override the Analyst's inference.
    private async Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseAsync(MatchRequest request, CancellationToken cancellationToken = default)
    {
        var (parsed, snap) = await _claudeClient.ParseJobDescriptionAsync(request.JobDescription, cancellationToken);
        var parsedJob = parsed with
        {
            JobTitle = !string.IsNullOrWhiteSpace(request.Title) ? request.Title! : parsed.JobTitle,
            Company = !string.IsNullOrWhiteSpace(request.Company) ? request.Company : parsed.Company,
        };
        return (parsedJob, snap);
    }

    // Re-derive verdict from the numeric score (authoritative bands) and recompute
    // shouldApply from the save threshold — the AI's own verdict/flag are advisory.
    private MatchResponse Correct(MatchResponse r, ScoringConfig cfg, int reviewCap)
    {
        r = EnforceReviewCaps(r, reviewCap);
        r = EnforceStackedGapsCap(r);
        var verdict = VerdictFromScore(r.OverallScore, cfg.VerdictBands) ?? r.Verdict;
        // The model reliably identifies a disqualifying condition in its
        // reasoning but doesn't reliably apply the consequence to its own
        // verdict field — same pattern as the review-cap enforcement below,
        // enforced here instead of trusted from the prompt alone.
        if (r.HardBlockers.Length > 0)
            verdict = "STRONG_NO";
        var shouldApply = r.OverallScore >= cfg.MinScoreToSave && verdict != "STRONG_NO";
        var rec = r.Recommendation is null ? null : r.Recommendation with { ShouldApply = shouldApply };
        return r with { Verdict = verdict, Recommendation = rec! };
    }

    // A posting with many individually-minor stack gaps was scored too
    // generously as an overall Core Stack match — tuning the verdict
    // threshold alone couldn't separate this pattern from genuinely strong
    // matches (their real scores overlap the same band). StackedGaps is a
    // separate, literal inventory the model fills independently of its own
    // Core Stack narrative score; when enough gaps stack up, cap the score
    // server-side rather than trust the model to self-discount it.
    private const int StackedGapsThreshold = 4;
    private const int StackedGapsCoreStackCeiling = 11;

    private MatchResponse EnforceStackedGapsCap(MatchResponse r)
    {
        if (r.StackedGaps.Length < StackedGapsThreshold) return r;
        var components = r.Breakdown.TechnicalFit.Components;
        var idx = Array.FindIndex(components, c => c.Name.Equals("Core Stack", StringComparison.OrdinalIgnoreCase));
        if (idx < 0 || components[idx].Score is not int score || score <= StackedGapsCoreStackCeiling)
            return r;

        var newComponents = (ScoreComponent[])components.Clone();
        newComponents[idx] = components[idx] with { Score = StackedGapsCoreStackCeiling };
        _logger.LogInformation(
            "Stacked-gaps cap enforcement: 'Core Stack' {Old} -> {New} ({GapCount} stacked gaps)",
            score, StackedGapsCoreStackCeiling, r.StackedGaps.Length);

        var techFit = r.Breakdown.TechnicalFit with
        {
            Components = newComponents,
            Score = newComponents.Sum(c => c.Score ?? 0),
        };
        var breakdown = r.Breakdown with { TechnicalFit = techFit };
        var overall = breakdown.TechnicalFit.Score is int t
                   && breakdown.EngineeringExecutionFit.Score is int e
                   && breakdown.SustainabilityPaceFit.Score is int s
            ? t + e + s
            : r.OverallScore;
        return r with { Breakdown = breakdown, OverallScore = overall };
    }

    // Evidence-volume cap from the EMPLOYEE REVIEW EVIDENCE prompt section.
    private static int ReviewCap(int? reviewCount) => reviewCount switch
    {
        null or < 50 => 1,
        < 200 => 2,
        _ => 3
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
