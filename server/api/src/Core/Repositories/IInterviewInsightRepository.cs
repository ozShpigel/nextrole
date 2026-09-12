using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// One insight document per user, keyed by userId (InterviewInsight.Id IS the userId).
public interface IInterviewInsightRepository
{
    Task<InterviewInsight?> GetAsync(Guid userId, CancellationToken ct = default);
    Task<InterviewInsight> UpsertAsync(Guid userId, InterviewInsight insight, CancellationToken ct = default);
}
