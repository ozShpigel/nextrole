using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IInterviewRepository
{
    Task<Interview> CreateAsync(Interview interview, CancellationToken ct = default);
    Task<Interview?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<Interview>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default);
    Task<List<Interview>> GetUpcomingAsync(int count = 5, CancellationToken ct = default);
    Task<Interview> UpdateAsync(Interview interview, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
