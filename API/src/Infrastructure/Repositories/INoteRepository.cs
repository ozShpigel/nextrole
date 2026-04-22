using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Infrastructure.Repositories;

public interface INoteRepository
{
    Task<Note> CreateAsync(Note note, CancellationToken ct = default);
    Task<Note?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<Note>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default);
    Task<Note> UpdateAsync(Note note, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
