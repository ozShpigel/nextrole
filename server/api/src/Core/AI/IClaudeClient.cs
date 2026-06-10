using ApplicationTracker.Core.Email;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Core.AI;

public interface IClaudeClient
{
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default);

    // Explicit-override variants used by the dry-run test endpoint: the prompt
    // and per-role config are supplied directly instead of being read from the
    // profile store, so a candidate (unsaved) prompt can be exercised.
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, string analystPrompt, RoleScoringConfig analystConfig, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, string evaluatorPrompt, RoleScoringConfig evaluatorConfig, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default);
    Task<EmailParseResult?> ParseEmailAsync(string subject, string from, string body, List<string> knownCompanies, CancellationToken cancellationToken = default);
    Task<string> SummarizeCompanyAsync(string companyName, CancellationToken cancellationToken = default);
}
