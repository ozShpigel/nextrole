namespace ApplicationTracker.Core.Matching;

public sealed record MatchResponse
{
    public string? JobTitle { get; init; }
    public string? Company { get; init; }
    public int? OverallScore { get; init; }
    public string Verdict { get; init; } = "INSUFFICIENT_DATA";
    public Breakdown Breakdown { get; init; } = new();
    public Recommendation Recommendation { get; init; } = new();
    public string HonestAssessment { get; init; } = "";
    public CompanyNewsAnalysis? CompanyNewsAnalysis { get; init; }
    public string? AnalystSnapshotInput { get; init; }
    public string? AnalystSnapshotOutput { get; init; }
    public string? EvaluatorSnapshotInput { get; init; }
    public string? EvaluatorSnapshotOutput { get; init; }
}

public sealed record Breakdown
{
    public TechnicalFitScore TechnicalFit { get; init; } = new();
    public EngineeringExecutionFitScore EngineeringExecutionFit { get; init; } = new();
    public SustainabilityPaceFitScore SustainabilityPaceFit { get; init; } = new();
}

public sealed record ScoreComponent
{
    public string Name { get; init; } = "";
    public int? Score { get; init; }
    public int? MaxScore { get; init; }
    public string Reason { get; init; } = "";
}

public sealed record TechnicalFitScore
{
    public int? Score { get; init; }
    public int? MaxScore { get; init; }
    public ScoreComponent[] Components { get; init; } = [];
    public string[] Strengths { get; init; } = [];
    public string[] Gaps { get; init; } = [];
}

public sealed record EngineeringExecutionFitScore
{
    public int? Score { get; init; }
    public int? MaxScore { get; init; }
    public ScoreComponent[] Components { get; init; } = [];
    public string[] Strengths { get; init; } = [];
    public string[] Concerns { get; init; } = [];
}

public sealed record SustainabilityPaceFitScore
{
    public int? Score { get; init; }
    public int? MaxScore { get; init; }
    public ScoreComponent[] Components { get; init; } = [];
    public string[] PositiveSignals { get; init; } = [];
    public string[] Concerns { get; init; } = [];
}

public sealed record CompanyNewsAnalysis
{
    public string[] GreenSignals { get; init; } = [];
    public string[] RedSignals { get; init; } = [];
    public string Summary { get; init; } = "";
}

public sealed record Recommendation
{
    public bool ShouldApply { get; init; }
    public string[] KeyReasons { get; init; } = [];
    public string[] QuestionsToAsk { get; init; } = [];
    public string[] RedFlags { get; init; } = [];
    public string[] GreenFlags { get; init; } = [];
}
