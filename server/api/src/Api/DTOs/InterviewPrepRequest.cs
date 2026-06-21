using System.Text.Json.Serialization;

namespace ApplicationTracker.Api.DTOs;

// Per-field carry-forward semantics: null = keep existing value, non-null =
// overwrite. For qa_rubric, a non-null list replaces the whole list; null
// carries the existing list forward.
public sealed record InterviewPrepRequest
{
    [JsonPropertyName("self_presentation_hr")]
    public string? SelfPresentationHr { get; init; }

    [JsonPropertyName("self_presentation_technical")]
    public string? SelfPresentationTechnical { get; init; }

    [JsonPropertyName("presenting_work_project")]
    public string? PresentingWorkProject { get; init; }

    [JsonPropertyName("presenting_personal_project")]
    public string? PresentingPersonalProject { get; init; }

    [JsonPropertyName("qa_rubric")]
    public List<QaEntryDto>? QaRubric { get; init; }
}

// Body for POST /api/match/interview-prep/cues — which self-presentation field
// to summarize into keyword reminders. The text is read from the saved doc
// server-side so cues are cached per saved version; `force` bypasses the cache.
public sealed record PresentationCuesRequest
{
    [JsonPropertyName("field")]
    public string Field { get; init; } = "";

    [JsonPropertyName("force")]
    public bool Force { get; init; }
}

public sealed record QaEntryDto
{
    [JsonPropertyName("question")]
    public string Question { get; init; } = "";

    [JsonPropertyName("answer")]
    public string Answer { get; init; } = "";
}
