using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface INoteRepository
{
    Task<Note> CreateAsync(Guid userId, Note note, CancellationToken ct = default);
    Task<Note?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default);
    Task<List<Note>> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default);
    Task<Note> UpdateAsync(Guid userId, Note note, CancellationToken ct = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default);
}
