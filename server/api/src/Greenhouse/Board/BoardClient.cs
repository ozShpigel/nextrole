using ApplicationTracker.Core.Greenhouse;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ApplicationTracker.Greenhouse;

public sealed class BoardClient : IBoardClient
{
    private readonly HttpClient _http;
    private readonly ILogger<BoardClient> _log;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public BoardClient(HttpClient http, ILogger<BoardClient> log)
    {
        _http = http;
        _log = log;
    }

    /// <summary>
    /// Fetch one whole board. Public endpoint, no auth.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>One call returns everything.</b> Verified against four boards: the
    /// endpoint does not paginate, and <c>meta.total</c> matched the returned
    /// job count exactly on every one (stripe 665, gitlab 216, airbnb 168,
    /// similarweb 66). Stripe's board — the largest tested — is 5.1 MB with
    /// <c>content=true</c> and arrives in 1.7 seconds.
    /// </para>
    /// <para>
    /// So there is no page to be incomplete. What CAN happen is a truncated
    /// body: a connection reset part-way through 5 MB. That is what the
    /// <c>meta.total</c> cross-check catches, and it throws — because the
    /// caller's diff would otherwise read the missing tail as jobs that closed.
    /// </para>
    /// </remarks>
    public async Task<IReadOnlyList<BoardJob>> FetchAsync(string boardToken, CancellationToken ct)
    {
        var url = $"v1/boards/{Uri.EscapeDataString(boardToken)}/jobs?content=true";

        HttpResponseMessage response;
        try
        {
            response = await _http.GetAsync(url, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            throw new BoardFetchException($"Board '{boardToken}' could not be reached.", e);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                // 429 and 5xx are explicitly the same outcome as any other
                // failure HERE: the message is nacked to the DLQ and this
                // company's stored jobs are left exactly as they were. The
                // retry is tomorrow's timer, not a loop — one board being rate
                // limited must not hold the queue open or cost the other
                // companies their run.
                var body = await SafeBodyAsync(response, ct);
                throw new BoardFetchException(
                    $"Board '{boardToken}' returned {(int)response.StatusCode} {response.StatusCode}. {body}");
            }

            BoardResponse? parsed;
            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                parsed = await JsonSerializer.DeserializeAsync<BoardResponse>(stream, Json, ct);
            }
            catch (JsonException e)
            {
                // A truncated body lands here far more often than the count
                // check below, because JSON stops being valid before it stops
                // being short. Still a fetch failure, never an empty board.
                throw new BoardFetchException($"Board '{boardToken}' returned a body that did not parse.", e);
            }

            if (parsed is null)
                throw new BoardFetchException($"Board '{boardToken}' returned a null body.");

            if (parsed.Meta?.Total is { } total && total != parsed.Jobs.Count)
                throw new BoardFetchException(
                    $"Board '{boardToken}' said meta.total={total} but returned {parsed.Jobs.Count} jobs. "
                    + "Treating a short response as the full board would close the missing listings.");

            // id is the board's primary key and the upsert's. A row without one
            // cannot be identified across runs, so it is dropped rather than
            // stored under a key we invented.
            var usable = parsed.Jobs.Where(j => j.Id != 0).ToList();
            if (usable.Count != parsed.Jobs.Count)
                _log.LogWarning("Board {Board}: dropped {Count} job(s) with no id",
                    boardToken, parsed.Jobs.Count - usable.Count);

            _log.LogInformation("Board {Board}: fetched {Count} job(s)", boardToken, usable.Count);
            return usable;
        }
    }

    private static async Task<string> SafeBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length > 300 ? body[..300] : body;
        }
        catch
        {
            return "";
        }
    }
}
