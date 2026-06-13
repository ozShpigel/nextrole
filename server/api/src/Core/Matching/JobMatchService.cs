using ApplicationTracker.Core.AI;
using ApplicationTracker.Core.Profile;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Core.Matching;

public sealed class JobMatchService : IJobMatchService
{
    private readonly IProfileProvider _profileProvider;
    private readonly IClaudeClient _claudeClient;
    private readonly ILogger<JobMatchService> _logger;

    public JobMatchService(
        IProfileProvider profileProvider,
        IClaudeClient claudeClient,
        ILogger<JobMatchService> logger)
    {
        _profileProvider = profileProvider;
        _claudeClient = claudeClient;
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
        var scoringConfig = await _profileProvider.GetScoringConfigAsync(cancellationToken);

        var (parsedJob, analystSnap) = await ParseAsync(request, cancellationToken);
        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, request.CompanyNews, request.GlassdoorData, cancellationToken);

        var corrected = Correct(matchResponse, scoringConfig) with
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
        var cfg = await _profileProvider.GetScoringConfigAsync(cancellationToken);
        var lines = result.Lines
            .Select(l => l.Response is null ? l : l with { Response = Correct(l.Response, cfg) })
            .ToList();
        return result with { Lines = lines };
    }

    // Re-derive verdict from the numeric score (authoritative bands) and recompute
    // shouldApply from the save threshold — the AI's own verdict/flag are advisory.
    private MatchResponse Correct(MatchResponse r, ScoringConfig cfg)
    {
        var verdict = VerdictFromScore(r.OverallScore, cfg.VerdictBands) ?? r.Verdict;
        var shouldApply = r.OverallScore >= cfg.MinScoreToSave;
        var rec = r.Recommendation is null ? null : r.Recommendation with { ShouldApply = shouldApply };
        return r with { Verdict = verdict, Recommendation = rec! };
    }

    public async Task<TestPromptResult> TestPromptAsync(TestPromptRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Dry-run test: target={Target}", request.Target);

        // Resolve the saved baseline; candidate (unsaved) fields override it.
        var doc = await _profileProvider.GetProfileDocumentAsync(cancellationToken);
        var savedConfig = await _profileProvider.GetScoringConfigAsync(cancellationToken);
        var candidateConfig = request.ScoringConfig is not null
            ? _profileProvider.ResolveScoringConfig(request.ScoringConfig)
            : savedConfig;

        var stages = new List<TestPromptStageResult>();

        // Stage 1 — parse. Candidate analyst prompt only applies when testing the
        // analyst; evaluator tests parse with the SAVED analyst so the parsed job
        // is the same input the live pipeline would feed the evaluator.
        var analystPrompt = request.Target == "analyst"
            ? (request.AnalystPrompt ?? doc.AnalystPrompt)
            : doc.AnalystPrompt;
        var analystCfg = request.Target == "analyst" ? candidateConfig.Analyst : savedConfig.Analyst;

        ParsedJob? parsed = null;
        try
        {
            var (p, snap) = await _claudeClient.ParseJobDescriptionAsync(
                request.JobDescription, analystPrompt, analystCfg, cancellationToken);
            parsed = p with { RawDescription = request.JobDescription };
            stages.Add(new TestPromptStageResult
            {
                Stage = "parse",
                DeserializedCleanly = true,
                RawOutput = snap.Output,
                Input = snap.Input,
            });
        }
        catch (ClaudeJsonException ex)
        {
            stages.Add(new TestPromptStageResult
            {
                Stage = "parse", DeserializedCleanly = false,
                RawOutput = ex.RawOutput, Input = ex.Input, Error = ex.Message,
            });
            return new TestPromptResult { Success = false, Stages = stages };
        }
        catch (Exception ex)
        {
            stages.Add(new TestPromptStageResult { Stage = "parse", DeserializedCleanly = false, Error = ex.Message });
            return new TestPromptResult { Success = false, Stages = stages };
        }

        if (request.Target == "analyst")
        {
            return new TestPromptResult { Success = true, Stages = stages, Parsed = parsed };
        }

        // Stage 2 — evaluate with the candidate evaluator prompt / profile / config.
        var evaluatorPrompt = request.EvaluatorPrompt ?? doc.EvaluatorPrompt;
        var profile = request.Profile ?? doc.Content;
        try
        {
            var (eval, snap) = await _claudeClient.EvaluateMatchAsync(
                profile, parsed, evaluatorPrompt, candidateConfig.Evaluator, null, null, cancellationToken);
            stages.Add(new TestPromptStageResult
            {
                Stage = "evaluate", DeserializedCleanly = true,
                RawOutput = snap.Output, Input = snap.Input,
            });

            var verdict = VerdictFromScore(eval.OverallScore, candidateConfig.VerdictBands) ?? eval.Verdict;
            return new TestPromptResult
            {
                Success = true, Stages = stages, Parsed = parsed,
                Evaluation = eval, OverallScore = eval.OverallScore, Verdict = verdict,
            };
        }
        catch (ClaudeJsonException ex)
        {
            stages.Add(new TestPromptStageResult
            {
                Stage = "evaluate", DeserializedCleanly = false,
                RawOutput = ex.RawOutput, Input = ex.Input, Error = ex.Message,
            });
            return new TestPromptResult { Success = false, Stages = stages, Parsed = parsed };
        }
        catch (Exception ex)
        {
            stages.Add(new TestPromptStageResult { Stage = "evaluate", DeserializedCleanly = false, Error = ex.Message });
            return new TestPromptResult { Success = false, Stages = stages, Parsed = parsed };
        }
    }
}
