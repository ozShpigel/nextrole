using System.Security.Cryptography;
using System.Text;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;
using MongoDB.Driver;

namespace ApplicationTracker.Infrastructure.Repositories;

public sealed class MatchSnapshotRepository : IMatchSnapshotRepository
{
    private readonly UserScopedCollection<MatchSnapshot> _snapshots;

    public MatchSnapshotRepository(UserScopedCollection<MatchSnapshot> snapshots) => _snapshots = snapshots;

    public async Task<string?> UpsertAsync(
        Guid userId,
        string? analystInput, string? analystOutput,
        string? evaluatorInput, string? evaluatorOutput,
        CancellationToken ct = default)
    {
        if (analystInput is null && analystOutput is null && evaluatorInput is null && evaluatorOutput is null)
            return null;

        // userId is part of the hash so content-addressing stays per-user:
        // two users can never collapse onto (or overwrite) one document, even
        // though their snapshot text would have to be byte-identical to collide
        // in the first place.
        var id = Hash(userId, analystInput, analystOutput, evaluatorInput, evaluatorOutput);

        // SetOnInsert rather than Replace — a batch of 5 applications each call
        // this with identical content; only the first write should actually
        // happen, the other 4 are no-ops against the already-stored document.
        // UserId is not set here: the scoped filter carries it, so the upsert
        // materialises it onto the new document from the filter equality.
        var update = Builders<MatchSnapshot>.Update
            .SetOnInsert(s => s.AnalystInput, analystInput)
            .SetOnInsert(s => s.AnalystOutput, analystOutput)
            .SetOnInsert(s => s.EvaluatorInput, evaluatorInput)
            .SetOnInsert(s => s.EvaluatorOutput, evaluatorOutput)
            .SetOnInsert(s => s.CreatedAt, DateTime.UtcNow);
        await _snapshots.UpdateOneAsync(userId, s => s.Id == id, update, new UpdateOptions { IsUpsert = true }, ct);
        return id;
    }

    private static string Hash(Guid userId, string? a, string? b, string? c, string? d)
    {
        // \0-separated so e.g. ("ab","c") and ("a","bc") never collide.
        var input = string.Join('\0', userId.ToString(), a ?? "", b ?? "", c ?? "", d ?? "");
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexStringLower(bytes);
    }
}
