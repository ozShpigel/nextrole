using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IMockInterviewRepository
{
    Task<MockInterviewSession> CreateAsync(Guid userId, MockInterviewSession session, CancellationToken ct = default);
    Task<MockInterviewSession?> GetByIdAsync(Guid userId, Guid id, CancellationToken ct = default);
    // Newest-first. Returns full sessions; the list endpoint projects a
    // lightweight shape (one user's transcripts stay small).
    Task<List<MockInterviewSession>> GetAllAsync(Guid userId, CancellationToken ct = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default);
}
