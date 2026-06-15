using System.Text.Json.Serialization;

namespace ApplicationTracker.Api.DTOs;

// Per-field carry-forward semantics (mirrors UpdateProfileRequest):
// null = keep existing value, non-null = overwrite. For qa_rubric, a non-null
// list replaces the whole list; null carries the existing list forward.
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

// Body for POST /api/match/interview-prep/cues — the self-presentation text to
// turn into keyword reminders. Sent from the editor (may be unsaved), so the
// text is supplied directly rather than read from the stored doc.
public sealed record PresentationCuesRequest
{
    [JsonPropertyName("text")]
    public string Text { get; init; } = "";
}

public sealed record QaEntryDto
{
    [JsonPropertyName("question")]
    public string Question { get; init; } = "";

    [JsonPropertyName("answer")]
    public string Answer { get; init; } = "";
}
