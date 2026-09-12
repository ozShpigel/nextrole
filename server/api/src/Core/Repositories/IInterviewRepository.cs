using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IInterviewRepository
{
    Task<Interview> CreateAsync(Guid userId, Interview interview, CancellationToken ct = default);
    Task<Interview?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default);
    Task<List<Interview>> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default);
    Task<List<Interview>> GetUpcomingAsync(Guid userId, int count = 5, CancellationToken ct = default);
    // Completed interviews that have a retro (RetroRating set), most recent first.
    Task<List<Interview>> GetRetrosAsync(Guid userId, CancellationToken ct = default);
    Task<Interview> UpdateAsync(Guid userId, Interview interview, CancellationToken ct = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default);
}
