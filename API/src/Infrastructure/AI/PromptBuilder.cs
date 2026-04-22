using System.Text.Json;
using ApplicationTracker.Core.Matching;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Infrastructure.AI;

public sealed class PromptBuilder
{
    private readonly ILogger<PromptBuilder> _logger;

    public PromptBuilder(ILogger<PromptBuilder> logger)
    {
        _logger = logger;
    }

    public string BuildAnalysisPrompt(string jobDescription, string analystPrompt)
    {
        if (string.IsNullOrWhiteSpace(analystPrompt))
        {
            _logger.LogWarning("Analyst prompt is empty; parse request will likely fail");
        }

        return $"{analystPrompt}\n\n---\n\n## JOB DESCRIPTION TO PARSE\n\n{jobDescription}\n\n---\n\nParse this job description and return valid JSON matching the schema defined in your skill.";
    }

    public string BuildEvaluationPrompt(string profile, ParsedJob parsedJob, string evaluatorPrompt)
    {
        if (string.IsNullOrWhiteSpace(evaluatorPrompt))
        {
            _logger.LogWarning("Evaluator prompt is empty; evaluation request will likely fail");
        }

        var parsedJobJson = JsonSerializer.Serialize(parsedJob, new JsonSerializerOptions
        {
            WriteIndented = true
        });

        return evaluatorPrompt
            .Replace("{{USER_PROFILE}}", profile)
            .Replace("{{PARSED_JOB}}", parsedJobJson);
    }
}
