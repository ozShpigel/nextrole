using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

// Every method takes the owning userId explicitly rather than reading it from
// ambient request state: a caller cannot compile without deciding whose data
// it is asking for, and UserScopedCollection ANDs the filter on so an
// implementation cannot forget to apply it.
public interface IApplicationRepository
{
    /// <summary>
    /// Inserts the application for <paramref name="userId"/>. If a row with the
    /// same (UserId, Company, JobTitle) already exists — enforced by a unique
    /// index — the insert is suppressed and the existing row is returned with
    /// <c>Created = false</c>. This makes saves idempotent and closes the
    /// scraper's check-then-act duplicate race. Uniqueness is per user: two
    /// users tracking the same job at the same company are not duplicates.
    /// </summary>
    Task<(Application Application, bool Created)> CreateAsync(Guid userId, Application app, CancellationToken ct = default);
    Task<Application?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default);
    Task<List<Application>> GetAllAsync(Guid userId, CancellationToken ct = default);
    Task<List<ApplicationListItem>> GetAllListItemsAsync(Guid userId, CancellationToken ct = default);
    Task<Application> UpdateAsync(Guid userId, Application app, CancellationToken ct = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(Guid userId, string company, string jobTitle, CancellationToken ct = default);
    Task<List<Application>> GetByIdsAsync(Guid userId, IEnumerable<Guid> ids, CancellationToken ct = default);
    Task<List<ApplicationSummary>> GetAllSummariesAsync(Guid userId, CancellationToken ct = default);
}
