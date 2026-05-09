using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class NoteRepository : INoteRepository
{
    private readonly IMongoCollection<Note> _notes;

    public NoteRepository(IMongoCollection<Note> notes) => _notes = notes;

    public async Task<Note> CreateAsync(Note note, CancellationToken ct = default)
    {
        await _notes.InsertOneAsync(note, cancellationToken: ct);
        return note;
    }

    public async Task<Note?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _notes.Find(n => n.Id == id).FirstOrDefaultAsync(ct);
    }

    public async Task<List<Note>> GetByApplicationIdAsync(Guid applicationId, CancellationToken ct = default)
    {
        return await _notes.Find(n => n.ApplicationId == applicationId)
            .SortByDescending(n => n.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<Note> UpdateAsync(Note note, CancellationToken ct = default)
    {
        await _notes.ReplaceOneAsync(n => n.Id == note.Id, note, cancellationToken: ct);
        return note;
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await _notes.DeleteOneAsync(n => n.Id == id, ct);
    }
}
