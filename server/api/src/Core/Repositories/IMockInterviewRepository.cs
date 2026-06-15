using ApplicationTracker.Core.Models;

namespace ApplicationTracker.Core.Repositories;

public interface IMockInterviewRepository
{
    Task<MockInterviewSession> CreateAsync(MockInterviewSession session, CancellationToken ct = default);
    Task<MockInterviewSession?> GetByIdAsync(Guid id, CancellationToken ct = default);
    // Newest-first. Returns full sessions; the list endpoint projects a
    // lightweight shape (the per-session transcripts stay small for a single user).
    Task<List<MockInterviewSession>> GetAllAsync(CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
