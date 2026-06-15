using MongoDB.Bson.Serialization.Attributes;

namespace ApplicationTracker.Core.Models;

// One exchange in a mock-interview transcript. `Role` is "interviewer" or
// "candidate". `Nudge` is the light one-line feedback the interviewer gives on
// the candidate's *previous* answer (carried on the candidate turn it refers
// to). `IsFollowUp` marks an interviewer question that drilled into the prior
// answer rather than moving to a new topic.
public sealed record MockInterviewTurn
{
    public string Role { get; init; } = "interviewer";
    public string Text { get; init; } = "";
    public string? Nudge { get; init; }
    public bool IsFollowUp { get; init; }
}

// Fixed 1–5 rubric the debrief scores every session against.
public sealed record MockInterviewScores
{
    public int Structure { get; init; }
    public int Relevance { get; init; }
    public int Specificity { get; init; }
    public int Clarity { get; init; }
}

// A suggested stronger phrasing for one weak answer — the basis of the
// "adopt into Q&A rubric" closed loop.
public sealed record MockInterviewRewrite
{
    public string Question { get; init; } = "";
    public string SuggestedAnswer { get; init; } = "";
}

public sealed record MockInterviewDebrief
{
    public MockInterviewScores Scores { get; init; } = new();
    public List<string> Highlights { get; init; } = new();
    public List<string> Improvements { get; init; } = new();
    public List<MockInterviewRewrite> Rewrites { get; init; } = new();
}

// What the AI needs to drive (or debrief) a turn. `Application` is null for a
// generic practice run; when present the job/company context is injected as
// untrusted data so the questions are tailored to the real role.
public sealed record MockInterviewContext
{
    public string Persona { get; init; } = "hr";        // hr | technical
    public string Language { get; init; } = "he";       // he | en
    public int QuestionTarget { get; init; } = 6;
    public Application? Application { get; init; }
}

// The interviewer's reply for one turn (stateless engine output).
public sealed record MockTurnResult
{
    public string Nudge { get; init; } = "";
    public string NextQuestion { get; init; } = "";
    public bool IsFollowUp { get; init; }
    public bool Done { get; init; }
}

// A persisted, completed (or in-review) mock-interview session.
public sealed record MockInterviewSession
{
    [BsonId]
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Persona { get; init; } = "hr";
    public string Mode { get; init; } = "generic";      // generic | bound
    [BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid? ApplicationId { get; init; }
    public string? Company { get; init; }
    public string? JobTitle { get; init; }
    public string Language { get; init; } = "he";
    public List<MockInterviewTurn> Turns { get; init; } = new();
    public MockInterviewDebrief? Debrief { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; init; }
}
