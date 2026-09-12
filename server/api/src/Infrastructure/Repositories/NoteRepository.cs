using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class NoteRepository : INoteRepository
{
    private readonly UserScopedCollection<Note> _notes;

    public NoteRepository(UserScopedCollection<Note> notes) => _notes = notes;

    public async Task<Note> CreateAsync(Guid userId, Note note, CancellationToken ct = default)
    {
        var owned = note with { UserId = userId };
        await _notes.InsertOneAsync(userId, owned, ct);
        return owned;
    }

    public async Task<Note?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        return await _notes.Find(userId, n => n.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<Note>> GetByApplicationIdAsync(Guid userId, Guid applicationId, CancellationToken ct = default)
    {
        return await _notes.Find(userId, n => n.ApplicationId == applicationId)
            .SortByDescending(n => n.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<Note> UpdateAsync(Guid userId, Note note, CancellationToken ct = default)
    {
        var owned = note with { UserId = userId };
        await _notes.ReplaceOneAsync(userId, n => n.Id == owned.Id, owned, ct: ct);
        return owned;
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        await _notes.DeleteOneAsync(userId, n => n.Id == id, ct);
    }
}
