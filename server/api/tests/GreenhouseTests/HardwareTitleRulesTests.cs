using ApplicationTracker.Core.Matching;
using ApplicationTracker.Infrastructure.Greenhouse;
using ApplicationTracker.Greenhouse;
using Xunit;

namespace GreenhouseTests;

/// <summary>
/// The hardware title guess (Prefilter.IsHardwareTitle), on KLA's and NVIDIA's
/// real titles as labelled on 2026-09-28. One-sided like every pre-read rule:
/// a hardware word is not enough when the title also says software.
/// </summary>
public class HardwareTitleRulesTests
{
    private const string Hardware = JobFunctions.HardwareEngineering;

    [Theory]
    [InlineData("Senior Package Layout Engineer")]
    [InlineData("Senior Chip Design Verification Engineer")]
    [InlineData("Senior Full Chip Layout Engineer")]
    [InlineData("Senior Opto-Mechanical Engineer")]
    [InlineData("Thermal Engineer")]
    [InlineData("Senior PCB Layout Engineer")]
    [InlineData("Mechanical Design Engineer")]
    [InlineData("Optical Lab Technician")]
    [InlineData("Laser integration practical engineer")]
    [InlineData("Senior VLSI Engineer")]
    [InlineData("Senior DFT Engineer")]
    [InlineData("Physical Design STA Engineer")]
    [InlineData("Senior IC Failure Analysis Engineer")]
    [InlineData("Physicist - Electro Optics Engineer")]
    [InlineData("Hardware Manager, Switch Design")]
    public void A_plainly_hardware_title_is_guessed_hardware(string title) =>
        Assert.Equal(Hardware, Prefilter.GuessFunction(title, [], hardwareTitles: true));

    [Theory]
    [InlineData("Senior Software Engineer, Chip Design")]           // software written for hardware
    [InlineData("Senior Firmware Engineer - NVLink Switch")]
    [InlineData("Firmware Design Engineer")]
    [InlineData("Linux Driver Developer")]
    [InlineData("Senior Hardware Security Architect")]              // security is read
    [InlineData("Senior AI STA Engineer, Sub-chip")]                // AI is read
    [InlineData("Software QA Engineer, Host BMC")]
    [InlineData("Senior Software Engineer")]
    [InlineData("DevOps Engineer")]
    [InlineData("Algorithm Engineer - High-Performance Geometry & Optimization")]
    [InlineData("Senior C++ Software Engineer")]
    [InlineData("Senior Site Reliability Engineer")]
    public void A_title_that_is_software_or_says_nothing_of_hardware_is_read(string title) =>
        Assert.Null(Prefilter.GuessFunction(title, [], hardwareTitles: true));

    [Theory]
    // Measured 2026-09-29 by the check line, with the rule On: each was called
    // hardware by the title and labelled otherwise by Claude.
    [InlineData("SOC Analyst")]                               // Security Operations Center, labelled security
    [InlineData("SOC Engineer")]
    [InlineData("Senior NPI Hardware Quality Engineer")]      // labelled qa
    [InlineData("Help Desk Technician (Tier 1)")]             // IT support
    [InlineData("End User Support Technician")]
    public void A_measured_wrong_hardware_guess_is_no_longer_hardware(string title) =>
        Assert.False(Prefilter.IsHardwareTitle(title), $"'{title}' is not hardware work.");

    [Theory]
    // Still hardware without "soc": a chip title carries another hardware word.
    [InlineData("SoC Physical Design Engineer")]
    [InlineData("Senior ASIC DFT Engineer")]
    [InlineData("SoC Verification Engineer, ASIC")]
    public void A_chip_SoC_title_is_still_hardware(string title) =>
        Assert.True(Prefilter.IsHardwareTitle(title));

    [Fact]
    public void The_plain_title_rules_still_come_first() =>
        Assert.Equal(JobFunctions.Operations,
            Prefilter.GuessFunction("HR Business Partner, Hardware", [], hardwareTitles: true));

    [Fact]
    public void Off_a_technical_hardware_title_is_read_as_before() =>
        Assert.Null(Prefilter.GuessFunction("Mechanical Design Engineer", []));

    private static ListedPosting Posting(string title) =>
        new("1", title, "Tel Aviv", [], [], null, null);

    private static readonly IReadOnlyCollection<string> SoftwareUsers =
        Prefilter.Accepted([JobFunctions.SoftwareEngineering, JobFunctions.Infrastructure]);

    [Fact]
    public void On_a_hardware_title_nobody_wants_is_skipped_and_off_it_is_not()
    {
        var served = ServedPlaces.From(["Tel Aviv"]);

        Assert.Equal(PrefilterSkip.Function,
            Prefilter.Decide(Posting("Senior VLSI Engineer"), served, SoftwareUsers, hardwareTitles: true)?.Reason);
        Assert.Null(Prefilter.Decide(Posting("Senior VLSI Engineer"), served, SoftwareUsers));
    }

    [Fact]
    public void A_hardware_title_is_read_when_some_user_wants_hardware()
    {
        var accepted = Prefilter.Accepted([JobFunctions.SoftwareEngineering, Hardware]);

        Assert.Null(Prefilter.Decide(Posting("Senior VLSI Engineer"), ServedPlaces.From(["Tel Aviv"]), accepted,
            hardwareTitles: true));
    }
}
