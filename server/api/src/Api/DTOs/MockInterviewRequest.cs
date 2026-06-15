using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Api.DTOs;

// One transcript turn as sent by the client (camelCase wire format).
public sealed record MockTurnDto
{
    public string Role { get; init; } = "";
    public string Text { get; init; } = "";
    public string? Nudge { get; init; }
    public bool IsFollowUp { get; init; }
}

// Body for POST /api/mock-interview/turn and .../debrief. Both are stateless:
// the client supplies the full transcript each call.
public sealed record MockInterviewTurnRequest
{
    public string? Persona { get; init; }       // hr | technical
    public string? Language { get; init; }      // he | en
    public int? QuestionTarget { get; init; }
    public Guid? ApplicationId { get; init; }
    public List<MockTurnDto>? Transcript { get; init; }
}

// Body for POST /api/mock-interview/sessions — persist a completed session.
public sealed record SaveMockSessionRequest
{
    public string? Persona { get; init; }
    public string? Language { get; init; }
    public string? Mode { get; init; }          // generic | bound
    public Guid? ApplicationId { get; init; }
    public string? Company { get; init; }
    public string? JobTitle { get; init; }
    public List<MockTurnDto>? Transcript { get; init; }
    public MockInterviewDebrief? Debrief { get; init; }
}

// Body for POST /api/mock-interview/adopt-rubric — append a debrief rewrite into
// the interview-prep Q&A rubric (closed loop).
public sealed record AdoptRubricRequest
{
    public string? Question { get; init; }
    public string? Answer { get; init; }
}
