using System.Text.Json;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The queue message across the phase 3 deploy (docs/plans/board-config.md):
/// messages published before it carry only a token, and the dead-letter queue
/// can hold one for days.
/// </summary>
public class CompanyMessageTests
{
    [Fact]
    public void A_message_from_before_board_keys_is_read_as_a_greenhouse_board()
    {
        var message = JsonSerializer.Deserialize<CompanyMessage>(
            """{ "boardToken": "wizinc", "day": "2026-09-28", "runId": "r1" }""");

        Assert.Equal("greenhouse:wizinc", message!.Key);
    }

    [Fact]
    public void The_key_wins_over_the_token()
    {
        // A Workday board with the same token must never run as the Greenhouse one.
        var message = JsonSerializer.Deserialize<CompanyMessage>(
            """{ "boardKey": "workday:wizinc", "boardToken": "wizinc", "day": "2026-09-28", "runId": "r1" }""");

        Assert.Equal("workday:wizinc", message!.Key);
    }

    [Fact]
    public void A_message_naming_no_board_has_no_key()
    {
        var message = JsonSerializer.Deserialize<CompanyMessage>("""{ "day": "2026-09-28", "runId": "r1" }""");

        Assert.Null(message!.Key);
    }

    [Fact]
    public void A_key_only_message_round_trips_to_its_board()
    {
        // What the publisher writes since 2c: the key, and no token. The
        // derived Key is not serialised -- it is computed on read.
        var json = JsonSerializer.Serialize(new CompanyMessage
        {
            BoardKey = "workday:wizinc", Day = "2026-09-28", RunId = "r1",
        });

        Assert.Contains("\"boardKey\":\"workday:wizinc\"", json);
        Assert.DoesNotContain("\"Key\"", json);
        Assert.Equal("workday:wizinc", JsonSerializer.Deserialize<CompanyMessage>(json)!.Key);
    }
}
