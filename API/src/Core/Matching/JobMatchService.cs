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

    private static string? VerdictFromScore(int? score) => score switch
    {
        >= 80 => "STRONG_YES",
        >= 60 => "YES",
        >= 40 => "MAYBE",
        >= 20 => "NO",
        >= 0  => "STRONG_NO",
        _     => null
    };

    public async Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting job match analysis");

        var profile = await _profileProvider.GetProfileAsync(cancellationToken);

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

        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, request.CompanyNews, cancellationToken);

        var correctedVerdict = VerdictFromScore(matchResponse.OverallScore) ?? matchResponse.Verdict;
        var correctedShouldApply = matchResponse.OverallScore >= 60;

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
}
