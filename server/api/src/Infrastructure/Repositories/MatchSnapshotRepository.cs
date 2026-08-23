using System.Security.Cryptography;
using System.Text;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class MatchSnapshotRepository : IMatchSnapshotRepository
{
    private readonly IMongoCollection<MatchSnapshot> _snapshots;

    public MatchSnapshotRepository(IMongoCollection<MatchSnapshot> snapshots) => _snapshots = snapshots;

    public async Task<string?> UpsertAsync(
        string? analystInput, string? analystOutput,
        string? evaluatorInput, string? evaluatorOutput,
        CancellationToken ct = default)
    {
        if (analystInput is null && analystOutput is null && evaluatorInput is null && evaluatorOutput is null)
            return null;

        var id = Hash(analystInput, analystOutput, evaluatorInput, evaluatorOutput);

        // SetOnInsert rather than Replace — a batch's 5 applications each call
        // this with identical content; only the first write should actually
        // happen, the other 4 are no-ops against the already-stored document.
        var update = Builders<MatchSnapshot>.Update
            .SetOnInsert(s => s.AnalystInput, analystInput)
            .SetOnInsert(s => s.AnalystOutput, analystOutput)
            .SetOnInsert(s => s.EvaluatorInput, evaluatorInput)
            .SetOnInsert(s => s.EvaluatorOutput, evaluatorOutput)
            .SetOnInsert(s => s.CreatedAt, DateTime.UtcNow);
        await _snapshots.UpdateOneAsync(s => s.Id == id, update, new UpdateOptions { IsUpsert = true }, ct);
        return id;
    }

    private static string Hash(string? a, string? b, string? c, string? d)
    {
        // \0-separated so e.g. ("ab","c") and ("a","bc") never collide.
        var input = string.Join('\0', a ?? "", b ?? "", c ?? "", d ?? "");
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexStringLower(bytes);
    }
}
