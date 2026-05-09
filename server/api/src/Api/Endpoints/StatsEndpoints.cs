using ApplicationTracker.Api.DTOs;
using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Api.Endpoints;

public static class StatsEndpoints
{
    public static WebApplication MapStatsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/stats", async (
            IApplicationRepository repo,
            CancellationToken ct) =>
        {
            var apps = await repo.GetAllSummariesAsync(ct);
            var total = apps.Count;
            var withScore = apps.Where(a => a.MatchScore.HasValue).ToList();
            var avgScore = withScore.Count > 0 ? (int)withScore.Average(a => a.MatchScore!.Value) : 0;

            var applied = apps.Count(a => a.Status >= ApplicationStatus.Applied);
            var heardBack = apps.Count(a =>
                a.Status is ApplicationStatus.PhoneScreen or ApplicationStatus.TechnicalInterview
                or ApplicationStatus.FinalRound or ApplicationStatus.OfferReceived
                or ApplicationStatus.Accepted or ApplicationStatus.Rejected);
            var responseRate = applied > 0 ? (int)(heardBack * 100.0 / applied) : 0;

            var inProgress = apps.Count(a =>
                a.Status is not ApplicationStatus.Rejected
                and not ApplicationStatus.Withdrawn
                and not ApplicationStatus.Accepted);

            var statusBreakdown = apps
                .GroupBy(a => a.Status)
                .ToDictionary(g => g.Key.ToString(), g => g.Count());

            return Results.Ok(new
            {
                total,
                inProgress,
                avgScore,
                responseRate,
                applied,
                heardBack,
                statusBreakdown
            });
        })
        .WithName("GetStats")
        .WithSummary("Get application statistics");

        app.MapGet("/api/applications/{id:guid}/timeline", async (
            Guid id,
            IStatusUpdateRepository statusRepo,
            IInterviewRepository interviewRepo,
            INoteRepository noteRepo,
            CancellationToken ct) =>
        {
            var statusUpdatesTask = statusRepo.GetByApplicationIdAsync(id, ct);
            var interviewsTask = interviewRepo.GetByApplicationIdAsync(id, ct);
            var notesTask = noteRepo.GetByApplicationIdAsync(id, ct);
            await Task.WhenAll(statusUpdatesTask, interviewsTask, notesTask);

            var statusUpdates = statusUpdatesTask.Result;
            var interviews = interviewsTask.Result;
            var notes = notesTask.Result;

            var timeline = new List<TimelineItem>();

            foreach (var s in statusUpdates)
                timeline.Add(new TimelineItem("status", s.Timestamp) { FromStatus = s.FromStatus, ToStatus = s.ToStatus, Note = s.Note });

            foreach (var i in interviews)
                timeline.Add(new TimelineItem("interview", i.ScheduledAt) { InterviewType = i.Type, Interviewer = i.Interviewer, Completed = i.Completed, Notes = i.Notes });

            foreach (var n in notes)
                timeline.Add(new TimelineItem("note", n.CreatedAt) { Content = n.Content, Category = n.Category });

            timeline.Sort((a, b) => a.Date.CompareTo(b.Date));
            return Results.Ok(timeline);
        })
        .WithName("GetTimeline")
        .WithSummary("Get application timeline");

        return app;
    }
}
