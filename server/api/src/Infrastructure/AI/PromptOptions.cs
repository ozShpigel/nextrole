namespace ApplicationTracker.Infrastructure.AI;

// Read-only configuration for the scoring/advisor system prompts. Bound from
// the "Prompts" config section via the Options pattern. The canonical text lives
// in PromptSeeds (code) and is used as the default; appsettings / environment
// variables (Prompts__Analyzer, Prompts__Evaluator, Prompts__Advisor) only
// override per-deploy. Admin-only: there is no UI/endpoint to edit these at runtime.
public sealed class PromptOptions
{
    public string Analyzer { get; set; } = PromptSeeds.Analyst;
    public string Evaluator { get; set; } = PromptSeeds.Evaluator;
    public string Advisor { get; set; } = PromptSeeds.Advisor;
}
