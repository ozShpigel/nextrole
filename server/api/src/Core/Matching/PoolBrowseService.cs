using System.Text.Json;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Core.Matching;

public interface IPoolBrowseService
{
    Task<PoolBrowseResult> BrowseAsync(Guid userId, PoolBrowseQuery query, CancellationToken ct = default);

    /// <summary>
    /// The retrieved band for this user — everything plausibly for them, in
    /// retrieval order, scored or not.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Costs no Claude call.</b> This is the cheap half of matching: one
    /// embedding of the profile and a vector search, ~95ms, so the board can
    /// show the real set of relevant postings immediately and score into it
    /// afterwards. <see cref="BrowseAsync"/> answers "what have we judged for
    /// this user"; this answers "what is there".
    /// </para>
    /// <para>
    /// Unscored items carry <c>Score = null</c>, which is already how this
    /// model spells "not judged" and what the card renders as an em dash. They
    /// are NOT given a provisional number: cosine similarity was measured
    /// against 29 real scores at +0.65 overall but −0.15 within the top ten, so
    /// it orders the field and not the leaderboard. Showing it as a score would
    /// publish a number that reshuffles the moment the real one lands.
    /// </para>
    /// <para>
    /// Order is retrieval order, deliberately, and it does not re-sort as
    /// scores arrive — a list that reorders under a reader is worse than one
    /// that is imperfectly sorted.
    /// </para>
    /// </remarks>
    Task<PoolBandResult> BandAsync(Guid userId, int limit, CancellationToken ct = default);
}

/// <summary>
/// The Matches page's data source: this user's scored pool jobs, filtered and
/// ranked.
/// </summary>
/// <remarks>
/// Three collections, and which one leads matters. A score is an opinion about
/// one candidate, so <c>jobScores</c> decides eligibility: a pool job with no
/// row for this user has never been scored for them and must not appear. The
/// pool document then says what the posting is, and <c>poolJobState</c> says
/// what this user has done about it.
///
/// The join is done here rather than in a <c>$lookup</c> because the sort key
/// lives in the joined collection. A user has at most a few hundred scored
/// jobs, so loading their rows and merging in memory is both simpler and
/// cheaper than a pipeline that would have to sort after the lookup anyway.
///
/// Defaults exclude triaged-out and dismissed jobs. Saved jobs stay visible,
/// because "already in my tracker" is not the same signal as "not interested".
/// </remarks>
public sealed class PoolBrowseService : IPoolBrowseService
{
    private readonly IJobScoreRepository _scores;
    private readonly IPoolJobRepository _pool;
    private readonly IPoolJobStateRepository _state;
    private readonly Profile.IProfileProvider _profiles;

    public PoolBrowseService(
        IJobScoreRepository scores, IPoolJobRepository pool, IPoolJobStateRepository state,
        Profile.IProfileProvider profiles)
    {
        _scores = scores;
        _pool = pool;
        _state = state;
        _profiles = profiles;
    }

    public async Task<PoolBrowseResult> BrowseAsync(
        Guid userId, PoolBrowseQuery query, CancellationToken ct = default)
    {
        query = query.Clamped();
        var empty = new PoolBrowseResult { Limit = query.Limit, Offset = query.Offset };

        // 1. This user's scores decide which pool jobs are eligible at all.
        var scored = (await _scores.GetScoredAsync(userId, query.MinScore, query.Verdicts, ct))
            .ToDictionary(s => s.JobId);
        if (scored.Count == 0) return empty;

        // 2. Saved/dismissed are per-user, so they are applied to this user's
        //    own rows rather than to the shared pool document — which also
        //    keeps the id list handed to Mongo smaller.
        var state = await _state.StateForAsync(userId, scored.Keys, ct);
        var eligible = scored.Keys.Where(jobId =>
        {
            if (!state.TryGetValue(jobId, out var st)) return true;
            if (!query.IncludeDismissed && st.Dismissed == true) return false;
            if (!query.IncludeSaved && st.SavedToTracker == true) return false;
            return true;
        }).ToList();
        if (eligible.Count == 0) return empty;

        // 3. The posting-level filters, against what survived -- including the
        //    profile's job functions. Without them, the function filter only
        //    stopped NEW scoring: postings already scored before it was on
        //    (the counting-only scans still scored them) stayed on the board,
        //    Sales Manager at 3 included. Applied at read time, so switching
        //    the flag off brings them back; no score is deleted.
        var structured = (await _profiles.GetProfileDocumentAsync(userId, ct)).Structured;
        query = query with { Functions = JobFunctions.AcceptedFor(structured.Functions) };

        var jobs = await _pool.BrowseAsync(eligible, query, ct);

        // 4. Merge this user's half back in, under the names the client reads.
        var merged = jobs.Select(job =>
        {
            var score = scored.GetValueOrDefault(job.Id);
            var st = state.GetValueOrDefault(job.Id);
            return job with
            {
                Score = score?.Score,
                Verdict = score?.Verdict,
                ShouldApply = score?.ShouldApply,
                MatchAnalysis = ParseAnalysis(score?.MatchAnalysis),
                SavedToTracker = st?.SavedToTracker == true,
                Dismissed = st?.Dismissed == true,
            };
        })
        // Best match first. The sort key is the user's score, which is why this
        // cannot be done in the pool query.
        .OrderByDescending(j => j.Score ?? 0)
        .ToList();

        return new PoolBrowseResult
        {
            Jobs = merged.Skip(query.Offset).Take(query.Limit).ToList(),
            Total = merged.Count,
            Limit = query.Limit,
            Offset = query.Offset,
        };
    }

    /// <inheritdoc />
    public async Task<PoolBandResult> BandAsync(Guid userId, int limit, CancellationToken ct = default)
    {
        limit = Math.Max(1, Math.Min(limit, PoolBandResult.MaxLimit));

        var structured = (await _profiles.GetProfileDocumentAsync(userId, ct)).Structured;
        if (structured.Experience.Length == 0 && structured.Skills.Length == 0)
            return new PoolBandResult { ProfileMissing = true };

        var filter = CandidateFilter.FromProfile(structured);

        // No exclusions: the band is the whole relevant set, including what is
        // already scored, so the board is one list rather than two that have to
        // be reconciled in the client.
        var band = await _pool.FindCandidatesAsync(filter, [], limit, ct);
        if (band.Count == 0)
            return new PoolBandResult { PoolSize = await _pool.CountActiveAsync(ct) };

        var ids = band.Select(j => j.Id).ToList();
        var rank = ids.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);

        var scores = (await _scores.GetByJobIdsAsync(userId, ids, ct)).ToDictionary(s => s.JobId);
        var state = await _state.StateForAsync(userId, ids, ct);

        // Dismissed is the one per-user state that removes a posting from the
        // band. Saved stays: "already in my tracker" is not "not interested".
        var visible = ids.Where(id => state.GetValueOrDefault(id)?.Dismissed != true).ToList();

        var items = await _pool.BrowseAsync(visible, new PoolBrowseQuery().Clamped(), ct);

        var merged = items.Select(job =>
        {
            var score = scores.GetValueOrDefault(job.Id);
            var st = state.GetValueOrDefault(job.Id);
            return job with
            {
                Score = score?.Score,
                Verdict = score?.Verdict,
                ShouldApply = score?.ShouldApply,
                MatchAnalysis = ParseAnalysis(score?.MatchAnalysis),
                SavedToTracker = st?.SavedToTracker == true,
                Dismissed = st?.Dismissed == true,
            };
        })
        .OrderBy(j => rank.TryGetValue(j.Id, out var r) ? r : int.MaxValue)
        .ToList();

        return new PoolBandResult
        {
            Jobs = merged,
            PoolSize = await _pool.CountActiveAsync(ct),
            // A row with no Score has never been judged for this user. A row
            // whose Score is null because the model returned nothing HAS been
            // paid for, and must not be counted as outstanding work.
            Unscored = merged.Count(j => !scores.ContainsKey(j.Id)),
        };
    }

    /// <summary>
    /// JobScore.MatchAnalysis is stored JSON text; the client expects an
    /// object. Unparseable text yields null rather than throwing — a score row
    /// written by an older shape must not take the whole list down with it.
    /// </summary>
    private static JsonElement? ParseAnalysis(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonDocument.Parse(json).RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
