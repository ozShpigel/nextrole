using System.Text.Json;

namespace ApplicationTracker.Greenhouse;

/// <summary>
/// One GET of a whole board from a public careers API that answers in a single
/// response (Lever, Comeet), with the same guards as <see cref="BoardClient"/>.
/// </summary>
/// <remarks>
/// <b>A failed fetch is not an empty board.</b> Unreachable, a non-2xx, a body
/// that does not parse (a truncated download stops being valid JSON before it
/// stops being short) or a null body all throw <see cref="BoardFetchException"/>,
/// so the close diff never sees them. No retry: as for Greenhouse, the retry is
/// tomorrow's run, not a loop that holds the queue on one company.
/// </remarks>
internal static class PublicBoardApi
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public static async Task<T> GetAsync<T>(HttpClient http, string url, BoardConfig board, CancellationToken ct)
        where T : class
    {
        HttpResponseMessage response;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Accept.ParseAdd("application/json");
            response = await http.SendAsync(request, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            throw new BoardFetchException($"Board {board.Key} could not be reached.", e);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var body = await SafeBodyAsync(response, ct);
                throw new BoardFetchException(
                    $"Board {board.Key} returned {(int)response.StatusCode} {response.StatusCode}. {body}");
            }

            T? parsed;
            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                parsed = await JsonSerializer.DeserializeAsync<T>(stream, Json, ct);
            }
            catch (JsonException e)
            {
                throw new BoardFetchException($"Board {board.Key} returned a body that did not parse.", e);
            }

            return parsed ?? throw new BoardFetchException($"Board {board.Key} returned a null body.");
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
