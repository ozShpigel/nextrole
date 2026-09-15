using ApplicationTracker.Core.Matching;

namespace ArchitectureTests;

// The stamp stored beside a cached ParsedJob. It exists so a prompt edit cannot
// silently keep serving parses produced by the old prompt — and it is a hash
// rather than a hand-maintained integer precisely because the hand-maintained
// version is the one someone forgets to bump.
//
// These tests pin that property: every input that can change the output must
// change the stamp, and nothing else may.
public class ParseVersioningTests
{
    private const string Prompt = "# ROLE\nYou are an analyst. Extract the posting.";
    private const string Model = "claude-haiku-4-5-20251001";

    [Fact]
    public void The_same_inputs_give_the_same_stamp()
    {
        // Otherwise every restart would invalidate the whole pool.
        Assert.Equal(
            ParseVersioning.Compute(Prompt, Model, 0m),
            ParseVersioning.Compute(Prompt, Model, 0m));
    }

    [Fact]
    public void Editing_the_prompt_changes_the_stamp()
    {
        // The case the whole mechanism exists for: nobody has to remember.
        Assert.NotEqual(
            ParseVersioning.Compute(Prompt, Model, 0m),
            ParseVersioning.Compute(Prompt + "\nAlso extract the dress code.", Model, 0m));
    }

    [Fact]
    public void Changing_the_model_changes_the_stamp()
    {
        Assert.NotEqual(
            ParseVersioning.Compute(Prompt, Model, 0m),
            ParseVersioning.Compute(Prompt, "claude-sonnet-5", 0m));
    }

    [Fact]
    public void Changing_the_temperature_changes_the_stamp()
    {
        // Temperature is why the same prompt produces different parses run to
        // run — measured at 4 distinct values across 5 runs for several fields.
        // A parse cached at one temperature is not the same artifact as one
        // cached at another.
        Assert.NotEqual(
            ParseVersioning.Compute(Prompt, Model, 0m),
            ParseVersioning.Compute(Prompt, Model, 0.5m));
    }

    [Fact]
    public void Whitespace_in_the_prompt_is_not_cosmetic()
    {
        // Deliberately NOT normalized. Whitespace changes what the model sees,
        // so treating it as cosmetic would keep serving parses from a prompt
        // that no longer exists.
        Assert.NotEqual(
            ParseVersioning.Compute(Prompt, Model, 0m),
            ParseVersioning.Compute(Prompt.Replace("\n", "\n\n"), Model, 0m));
    }

    [Fact]
    public void The_stamp_is_short_and_storable()
    {
        var v = ParseVersioning.Compute(Prompt, Model, 0m);

        Assert.Equal(12, v.Length);
        Assert.Matches("^[0-9a-f]{12}$", v);
    }
}
