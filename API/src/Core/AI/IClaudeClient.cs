using ApplicationTracker.Core.Email;
using ApplicationTracker.Core.Matching;

namespace ApplicationTracker.Core.AI;

public interface IClaudeClient
{
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default);
    Task<EmailParseResult?> ParseEmailAsync(string subject, string from, string body, List<string> knownCompanies, CancellationToken cancellationToken = default);
}
