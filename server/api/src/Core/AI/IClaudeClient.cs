using ApplicationTracker.Core.Email;
using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Core.AI;

public interface IClaudeClient
{
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default);

    // Explicit-override variants: the prompt and per-role config are supplied
    // directly instead of being read from configuration. The parameterless
    // variants above delegate to these with the configured prompt/config.
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, string analystPrompt, RoleScoringConfig analystConfig, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, string evaluatorPrompt, RoleScoringConfig evaluatorConfig, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CancellationToken cancellationToken = default);
    // Batch evaluation (50% cheaper, async). Submit returns an Anthropic batch id;
    // poll returns processing status and — once ended — one result line per CustomId.
    // Used by the cron-driven discovery path; the live path stays synchronous.
    Task<string> SubmitEvaluationBatchAsync(IReadOnlyList<EvaluationBatchItem> items, CancellationToken cancellationToken = default);
    Task<EvaluationBatchResult> GetEvaluationBatchAsync(string batchId, CancellationToken cancellationToken = default);

    Task<EmailParseResult?> ParseEmailAsync(string subject, string from, string body, List<string> knownCompanies, CancellationToken cancellationToken = default);
    Task<string> SummarizeCompanyAsync(string companyName, CancellationToken cancellationToken = default);

    // Generates a personalized "why do you want to work here?" interview answer
    // (one Hebrew paragraph) from the application's company/job context plus the
    // user's profile and interview-prep self-presentation.
    Task<string> GenerateWhyWorkHereAsync(Application app, string profile, InterviewPrepDocument prep, CancellationToken cancellationToken = default);

    // Turns a written self-presentation into an ordered list of short keyword
    // cues (memory reminders), so the user can speak from memory rather than
    // read the text verbatim. Returns the cue lines in original order.
    Task<List<string>> GeneratePresentationCuesAsync(string presentationText, CancellationToken cancellationToken = default);

    // Mock interview (stateless turn engine). The transcript so far is supplied
    // by the caller; the interviewer's reply for the next turn is returned. Uses
    // the user's profile + interview-prep (trusted) and, when bound to an
    // application, the job/company context (untrusted, XML-wrapped).
    Task<MockTurnResult> GenerateMockInterviewTurnAsync(MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default);

    // End-of-session debrief: scores the whole transcript on the fixed 1–5
    // rubric and returns highlights, improvements, and answer rewrites.
    Task<MockInterviewDebrief> GenerateMockInterviewDebriefAsync(MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default);
}
