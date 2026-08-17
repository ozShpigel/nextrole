using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Api.DTOs;

// Manual edit of an already-generated résumé pack — no AI call, so there's
// no new Provenance to validate; Violations (from the last real generation)
// and GeneratedAt-as-"last touched" are handled by the endpoint, not sent here.
public record ResumePackUpdateRequest
{
    public required string TailoredSummary { get; init; }
    public required List<TailoredExperienceItem> Experience { get; init; }
    public required List<SkillCategory> HighlightedSkills { get; init; }
    public required List<SideProjectItem> SideProjects { get; init; }
}
