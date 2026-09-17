using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Repositories;

namespace ApplicationTracker.Api.Endpoints;

/// <summary>
/// Creating a tracked application: snapshot the raw Claude text, insert, and
/// open the status history.
/// </summary>
/// <remarks>
/// Extracted because there are now two ways in — <c>POST /api/applications</c>
/// and adding a job from the pool — and three ordered steps that must not
/// diverge between them. Before the pool save moved into this service it was
/// an HTTP call to the first endpoint, so the sequence was shared by
/// construction; keeping a single implementation is what preserves that now
/// the hop is gone.
/// </remarks>
internal static class ApplicationCreation
{
    public static async Task<(Application Created, bool IsNew)> CreateAsync(
        Guid userId,
        Application application,
        IApplicationRepository repo,
        IMatchSnapshotRepository snapshots,
        IStatusUpdateRepository statusRepo,
        ILogger logger,
        CancellationToken ct)
    {
        // Content-address the raw Claude snapshot text into its own collection
        // before persisting — batch-scored jobs send the same shared text on
        // every one of their applications, and this collapses N copies to one
        // stored document (see MatchSnapshot). The raw fields are [BsonIgnore]
        // on Application, so clearing them here also keeps any response body
        // honest about what actually got stored.
        var snapshotId = await snapshots.UpsertAsync(userId,
            application.AnalystSnapshotInput, application.AnalystSnapshotOutput,
            application.EvaluatorSnapshotInput, application.EvaluatorSnapshotOutput, ct);

        application = application with
        {
            SnapshotId = snapshotId,
            AnalystSnapshotInput = null,
            AnalystSnapshotOutput = null,
            EvaluatorSnapshotInput = null,
            EvaluatorSnapshotOutput = null,
        };

        var (created, isNew) = await repo.CreateAsync(userId, application, ct);

        if (!isNew)
        {
            logger.LogInformation(
                "Duplicate application suppressed: {Title} at {Company} (existing {Id})",
                created.JobTitle, created.Company, created.Id);
            return (created, false);
        }

        await statusRepo.CreateAsync(userId, new StatusUpdate
        {
            ApplicationId = created.Id,
            FromStatus = ApplicationStatus.Analyzing,
            ToStatus = created.Status,
            Note = "Job added to tracking"
        }, ct);

        logger.LogInformation(
            "Application created: {Id} - {Title} at {Company}",
            created.Id, created.JobTitle, created.Company);

        return (created, true);
    }
}
