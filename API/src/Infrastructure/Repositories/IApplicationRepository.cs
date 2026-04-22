using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Infrastructure.Repositories;

public interface IApplicationRepository
{
    Task<Application> CreateAsync(Application app, CancellationToken ct = default);
    Task<Application?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<Application>> GetAllAsync(CancellationToken ct = default);
    Task<Application> UpdateAsync(Application app, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(string company, string jobTitle, CancellationToken ct = default);
}
