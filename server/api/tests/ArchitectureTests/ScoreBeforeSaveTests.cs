using ApplicationTracker.Core.Matching;
using ApplicationTracker.Core.Models;
using Xunit;

namespace ArchitectureTests;

/// <summary>
/// Adding a posting from Matches before it has a score: it is scored first,
/// or its in-flight score is waited for -- never saved blank while a score is
/// about to land.
/// </summary>
public class ScoreBeforeSaveTests
{
    private static readonly JobScore Scored = new() { JobId = "j1", Score = 72, Verdict = "YES" };

    private sealed class Probe
    {
        public int Scores;
        public int Reads;
        public int Delays;
        public Func<int, JobScore?> ReadAt = _ => null;
        public PoolScanResult Result = new();

        public Task<JobScore?> EnsureAsync() => ScoreBeforeSave.EnsureAsync(
            _ => { Scores++; return Task.FromResult(Result); },
            _ => Task.FromResult(ReadAt(++Reads)),
            (_, _) => { Delays++; return Task.CompletedTask; },
            CancellationToken.None);
    }

    [Fact]
    public async Task Scores_the_posting_and_returns_the_score_it_stored()
    {
        var p = new Probe { Result = new PoolScanResult { Scored = 1 }, ReadAt = _ => Scored };

        Assert.Same(Scored, await p.EnsureAsync());
        Assert.Equal(1, p.Scores);
        Assert.Equal(0, p.Delays);
    }

    [Fact]
    public async Task Waits_for_a_batch_already_scoring_it_instead_of_saving_blank()
    {
        // The card was scrolled into view a moment before Add: its batch owns
        // the posting, and the score lands on the third read.
        var p = new Probe { Result = new PoolScanResult { ScanInProgress = true }, ReadAt = n => n >= 3 ? Scored : null };

        Assert.Same(Scored, await p.EnsureAsync());
        Assert.Equal(1, p.Scores);   // never paid for twice
        Assert.Equal(2, p.Delays);
    }

    [Fact]
    public async Task Gives_up_after_the_wait_and_lets_the_save_go_ahead_unscored()
    {
        var p = new Probe { Result = new PoolScanResult { ScanInProgress = true } };

        Assert.Null(await p.EnsureAsync());
        Assert.Equal(
            (int)(ScoreBeforeSave.WaitForInFlight / ScoreBeforeSave.PollInterval), p.Delays);
    }

    [Fact]
    public async Task With_the_budget_used_up_it_does_not_wait_for_a_score_that_is_not_coming()
    {
        var p = new Probe { Result = new PoolScanResult { BudgetExhausted = true } };

        Assert.Null(await p.EnsureAsync());
        Assert.Equal(0, p.Delays);
    }
}
