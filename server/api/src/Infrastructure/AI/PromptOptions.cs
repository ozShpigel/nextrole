namespace ApplicationTracker.Infrastructure.AI;

// Read-only configuration for the scoring system prompts. Bound from
// the "Prompts" config section via the Options pattern. The canonical text lives
// in PromptSeeds (code) and is used as the default; appsettings / environment
// variables (Prompts__Analyzer, Prompts__Evaluator) only
// override per-deploy. Admin-only: there is no UI/endpoint to edit these at runtime.
public sealed class PromptOptions
{
    public string Analyzer { get; set; } = PromptSeeds.Analyst;
    public string Evaluator { get; set; } = PromptSeeds.Evaluator;

    // Controls the {{OUTPUT_LANGUAGE}} token substituted into every
    // narrative-generating prompt (Evaluator, NarrativeEnrichment,
    // CompanySummary, PresentationCues, WhyWorkHere, TitleTriage,
    // InterviewInsights). Default false = English everywhere. Set true
    // (Prompts__HebrewOutput=true) only on the deployment that wants Hebrew
    // narrative output.
    public bool HebrewOutput { get; set; } = false;
}
