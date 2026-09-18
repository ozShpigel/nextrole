using System.Text.Json;
using ApplicationTracker.PoolIngest;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArchitectureTests;

/// <summary>
/// The role config the daily run reads, and the age-out window it carries.
/// </summary>
public class RolesConfigTests
{
    private static string WriteTemp(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), $"roles-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, json);
        return path;
    }

    [Fact]
    public void The_shipped_config_parses_and_carries_the_time_based_window()
    {
        // The file that ships in the image. A rename that missed it would leave
        // the run on the default rather than the configured value, silently.
        var shipped = Path.Combine(AppContext.BaseDirectory, "config", "roles.json");
        if (!File.Exists(shipped)) return;   // not copied into the test output

        using var doc = JsonDocument.Parse(File.ReadAllText(shipped));
        Assert.True(doc.RootElement.TryGetProperty("inactive_after_days", out _),
            "roles.json should carry inactive_after_days; missed_runs_before_inactive is retired (#86)");
    }

    [Fact]
    public void A_config_still_using_the_retired_key_falls_back_to_the_same_value()
    {
        // The old key meant "3 runs", the new one means "3 days", and on a daily
        // cron those were the same thing. So an un-migrated config degrades to
        // the default rather than to something surprising.
        var path = WriteTemp("""{"roles":["Backend Engineer"],"missed_runs_before_inactive":3}""");
        try
        {
            var config = RolesConfig.Load(path, NullLogger.Instance);
            Assert.Equal(3, config.InactiveAfterDays);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void An_explicit_window_is_honoured()
    {
        var path = WriteTemp("""{"roles":["Backend Engineer"],"inactive_after_days":7}""");
        try
        {
            Assert.Equal(7, RolesConfig.Load(path, NullLogger.Instance).InactiveAfterDays);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void A_config_with_no_roles_refuses_to_load()
    {
        // Deliberately fatal: a daily run over a silently-defaulted role set
        // would ingest the wrong pool for as long as nobody noticed.
        var path = WriteTemp("""{"roles":[]}""");
        try
        {
            Assert.Throws<InvalidOperationException>(() => RolesConfig.Load(path, NullLogger.Instance));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Duplicate_roles_are_collapsed_case_insensitively_keeping_the_files_order()
    {
        var path = WriteTemp("""{"roles":["Backend Engineer","backend engineer","Platform Engineer"]}""");
        try
        {
            var config = RolesConfig.Load(path, NullLogger.Instance);
            Assert.Equal(["Backend Engineer", "Platform Engineer"], config.Roles);
        }
        finally { File.Delete(path); }
    }
}
