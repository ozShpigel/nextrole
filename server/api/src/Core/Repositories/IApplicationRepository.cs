using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IApplicationRepository
{
    /// <summary>
    /// Inserts the application. If a row with the same (Company, JobTitle) already
    /// exists — enforced by a unique index — the insert is suppressed and the existing
    /// row is returned with <c>Created = false</c>. This makes saves idempotent and
    /// closes the scraper's check-then-act duplicate race.
    /// </summary>
    Task<(Application Application, bool Created)> CreateAsync(Application app, CancellationToken ct = default);
    Task<Application?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<Application>> GetAllAsync(CancellationToken ct = default);
    Task<List<ApplicationListItem>> GetAllListItemsAsync(CancellationToken ct = default);
    Task<Application> UpdateAsync(Application app, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(string company, string jobTitle, CancellationToken ct = default);
    Task<List<Application>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken ct = default);
    Task<List<ApplicationSummary>> GetAllSummariesAsync(CancellationToken ct = default);
}
