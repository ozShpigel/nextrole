namespace ApplicationTracker.Infrastructure.AI;

// Per-agent Hebrew-output toggles. Deliberately narrow: only the two agents
// whose narrative output carries no correctness/golden-set stake are listed
// here. Every other {{OUTPUT_LANGUAGE}} consumer — Evaluator (both
// PromptBuilder.BuildEvaluationPrompt/BuildEvaluationBatchPrompt),
// NarrativeEnrichment, PresentationCues, TitleTriage, InterviewInsights —
// resolves to English unconditionally in code (PromptBuilder.OutputLanguage;
// ClaudeClient's hardcoded `false` arguments to ResolveOutputLanguage), not
// through this options object, specifically so no env var here can ever flip
// the Evaluator into Hebrew and invalidate the golden-set baseline (measured
// on English Evaluator output — see docs/scoring-and-search.md).
public sealed class HebrewOutputOptions
{
    public bool WhyWorkHere { get; set; } = false;
    public bool CompanySummary { get; set; } = false;
}

// Read-only configuration for the scoring system prompts. Bound from
// the "Prompts" config section via the Options pattern. The canonical text lives
// in PromptSeeds (code) and is used as the default; appsettings / environment
// variables (Prompts__Analyzer, Prompts__Evaluator) only
// override per-deploy. Admin-only: there is no UI/endpoint to edit these at runtime.
public sealed class PromptOptions
{
    public string Analyzer { get; set; } = PromptSeeds.Analyst;
    public string Evaluator { get; set; } = PromptSeeds.Evaluator;

    // Replaces a previous single global `HebrewOutput` bool that substituted
    // {{OUTPUT_LANGUAGE}} into every narrative prompt, Evaluator included —
    // enabling Hebrew anywhere meant enabling it everywhere. This is
    // per-agent instead; see HebrewOutputOptions for which agents are
    // actually configurable and why the rest aren't.
    //
    // BREAKING CHANGE: a bare `Prompts__HebrewOutput=true` no longer does
    // anything (it doesn't bind to this now-nested shape and is silently
    // ignored — .NET's config binder just finds no matching leaf keys under
    // it). Deployments that want Hebrew must set the per-agent keys instead:
    // `Prompts__HebrewOutput__WhyWorkHere=true` and/or
    // `Prompts__HebrewOutput__CompanySummary=true`.
    public HebrewOutputOptions HebrewOutput { get; set; } = new();
}
