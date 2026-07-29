using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IInterviewInsightRepository
{
    Task<InterviewInsight?> GetAsync(CancellationToken ct = default);
    Task<InterviewInsight> UpsertAsync(InterviewInsight insight, CancellationToken ct = default);
}
