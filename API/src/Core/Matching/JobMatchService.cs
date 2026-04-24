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

    public async Task<MatchResponse> AnalyzeMatchAsync(MatchRequest request, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting job match analysis");

        var profile = await _profileProvider.GetProfileAsync(cancellationToken);

        ParsedJob parsedJob;
        ClaudeCallSnapshot? analystSnap = null;
        if (!string.IsNullOrWhiteSpace(request.Title))
        {
            _logger.LogInformation("Pre-parsed metadata supplied — skipping parse step ({Title} @ {Company})",
                request.Title, request.Company);
            parsedJob = new ParsedJob
            {
                JobTitle = request.Title!,
                Company = request.Company,
                RawDescription = request.JobDescription
            };
        }
        else
        {
            var (parsed, snap) = await _claudeClient.ParseJobDescriptionAsync(request.JobDescription, cancellationToken);
            parsedJob = parsed;
            analystSnap = snap;
        }

        var (matchResponse, evalSnap) = await _claudeClient.EvaluateMatchAsync(profile, parsedJob, cancellationToken);
        _logger.LogInformation("Match evaluation completed. Verdict: {Verdict}, Score: {Score}",
            matchResponse.Verdict, matchResponse.OverallScore);

        return matchResponse with
        {
            JobTitle = parsedJob.JobTitle,
            Company = parsedJob.Company,
            AnalystSnapshotInput = analystSnap?.Input,
            AnalystSnapshotOutput = analystSnap?.Output,
            EvaluatorSnapshotInput = evalSnap.Input,
            EvaluatorSnapshotOutput = evalSnap.Output
        };
    }
}
