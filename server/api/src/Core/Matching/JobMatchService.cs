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

        // Always run the Analyst — even when the caller (scraper) pre-supplies
        // title/company from JobSpy. Without the Analyst pass the Evaluator
        // gets an empty ParsedJob (no skills, cultural signals, tech stack)
        // and scores on vibes alone. We keep the scraper's canonical
        // title/company when supplied, since those come from the source
        // listing and are more authoritative than an Analyst inference.
        var (parsed, analystSnap) = await _claudeClient.ParseJobDescriptionAsync(request.JobDescription, cancellationToken);
        var parsedJob = parsed with
        {
            JobTitle = !string.IsNullOrWhiteSpace(request.Title) ? request.Title! : parsed.JobTitle,
            Company = !string.IsNullOrWhiteSpace(request.Company) ? request.Company : parsed.Company,
            RawDescription = request.JobDescription
        };

        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, request.CompanyNews, request.GlassdoorData, cancellationToken);

        var correctedVerdict = VerdictFromScore(matchResponse.OverallScore, scoringConfig.VerdictBands) ?? matchResponse.Verdict;
        var correctedShouldApply = matchResponse.OverallScore >= scoringConfig.MinScoreToSave;

        if (correctedVerdict != matchResponse.Verdict)
            _logger.LogWarning("Verdict corrected: AI returned {AiVerdict} for score {Score}, using {Corrected}",
                matchResponse.Verdict, matchResponse.OverallScore, correctedVerdict);
        if (correctedShouldApply != matchResponse.Recommendation.ShouldApply)
            _logger.LogWarning("ShouldApply corrected: AI returned {AiValue} for score {Score}, using {Corrected}",
                matchResponse.Recommendation.ShouldApply, matchResponse.OverallScore, correctedShouldApply);

        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            correctedVerdict, matchResponse.OverallScore);

        return matchResponse with
        {
            Verdict = correctedVerdict,
            Recommendation = matchResponse.Recommendation with { ShouldApply = correctedShouldApply },
            JobTitle = parsedJob.JobTitle,
            Company = parsedJob.Company,
            AnalystSnapshotInput = analystSnap.Input,
            AnalystSnapshotOutput = analystSnap.Output,
            EvaluatorSnapshotInput = evalSnap.Input,
            EvaluatorSnapshotOutput = evalSnap.Output
        };
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
