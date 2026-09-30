namespace ApplicationTracker.Api.Endpoints;

/// <summary>
/// The daily limit on adding jobs to the Active board: Save from Matches, and
/// creating an application at DecidedToApply by hand. Import job is not
/// counted -- it is a feature of its own, open only to its allowlist.
/// </summary>
/// <remarks>
/// A pacing limit, not a spend one: a few chosen roles a day. Claimed before
/// the application is written (IUserQuotaRepository.TryConsumeAddAsync) and
/// refunded when the add does not happen. Refused with 429, never 403 -- the
/// client reads every 403 as the demo-blocked message.
/// </remarks>
public static class ActiveBoardAllowance
{
    public const int AddsPerDay = 3;

    public const string ExhaustedMessage = "Daily limit reached: you can add 3 jobs to your board per day. More tomorrow.";

    public static IResult Exhausted() =>
        Results.Json(new { error = ExhaustedMessage, limit = AddsPerDay }, statusCode: StatusCodes.Status429TooManyRequests);
}
