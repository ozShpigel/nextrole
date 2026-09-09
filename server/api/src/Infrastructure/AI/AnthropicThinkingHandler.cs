using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ApplicationTracker.Infrastructure.AI;

// Bounds extended thinking on the claude-*-5 models, which Anthropic.SDK 5.9.0
// cannot express.
//
// Why this exists: the -5 models run *adaptive* thinking by default, and with no
// effort cap that budget is unbounded — it will happily consume the entire
// max_tokens allowance before emitting a single output token. The resume-pack
// prompt does exactly that: a live request came back stop_reason=max_tokens with
// output_tokens=16000 of which thinking_tokens=15999, and a single `thinking`
// content block — no `text` block at all. The streaming reader in ClaudeClient
// accumulates text deltas, got zero, and threw "Empty response from Claude API".
// Raising max_tokens only hands it more rope (4096 and 16000 both exhausted).
//
// The SDK can't fix this at the parameter level: ThinkingParameters.Type is a
// get-only "enabled", and the -5 models reject that shape outright —
//   400 "thinking.type.enabled is not supported for this model.
//        Use thinking.type.adaptive and output_config.effort"
// so the ThinkingEnabled/ThinkingBudget knobs in RoleScoringConfig are dead
// letters on these models. 5.10.0 adds an output_config field but still carries
// no adaptive/disabled/effort values, so upgrading doesn't help either.
//
// Measured against the real resume-pack request (16k max_tokens):
//   default (unbounded)  158s  thinking=15999  text=0      max_tokens   FAILS
//   effort=medium        127s  thinking=11502  text=6249   end_turn     13.6k/16k, too close
//   effort=low            37s  thinking= 2179  text=6039   end_turn     <-- chosen
//   thinking disabled     15s  thinking=    0  text=5122   end_turn
//
// effort=low keeps real reasoning (these prompts carry strict grounding and
// anti-fabrication rules that benefit from it) at a bounded, predictable cost.
// Drop to {"type":"disabled"} if latency ever matters more than that.
//
// Delete this handler once the SDK models adaptive thinking directly.
public sealed class AnthropicThinkingHandler : DelegatingHandler
{
    private static readonly JsonSerializerOptions Compact = new() { WriteIndented = false };

    // The families that default to unbounded adaptive thinking. Haiku 4.5 has no
    // adaptive mode and must not be touched — it rejects these fields.
    private static bool NeedsEffortCap(string? model) =>
        model is not null && (model.StartsWith("claude-opus-5", StringComparison.Ordinal)
                           || model.StartsWith("claude-sonnet-5", StringComparison.Ordinal));

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Content is not null && request.RequestUri?.AbsolutePath.EndsWith("/v1/messages", StringComparison.Ordinal) == true)
        {
            var body = await request.Content.ReadAsStringAsync(cancellationToken);
            if (JsonNode.Parse(body) is JsonObject root
                && NeedsEffortCap(root["model"]?.GetValue<string>())
                // Never override an explicit choice made further up the stack.
                && root["thinking"] is null && root["output_config"] is null)
            {
                root["thinking"] = new JsonObject { ["type"] = "adaptive" };
                root["output_config"] = new JsonObject { ["effort"] = "low" };

                var headers = request.Content.Headers;
                request.Content = new StringContent(root.ToJsonString(Compact), Encoding.UTF8, "application/json");
                // Preserve anything the SDK set on the original content headers
                // (notably the anthropic-beta values it attaches per request).
                foreach (var h in headers)
                {
                    if (!string.Equals(h.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(h.Key, "Content-Length", StringComparison.OrdinalIgnoreCase))
                    {
                        request.Content.Headers.TryAddWithoutValidation(h.Key, h.Value);
                    }
                }
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }
}
