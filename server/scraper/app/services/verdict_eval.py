"""Golden-set evaluation for the Evaluator (`POST /api/match`, the manual
"Score a Job" page's pipeline) — now also the primary regression gate for the
automatic ingest-time scoring flow, since every discovered job depends on
Evaluator correctness in a way the old RAG architecture never exposed.

Each case is scored via the exact real-usage path: only `jobDescription` is
sent (matching the manual page), letting the Analyst extract title/company
itself. The model's 6-value verdict is mapped to the golden set's 3-band
`expected` label; `INSUFFICIENT_DATA` is tracked as a separate "unscoreable"
outcome rather than silently folded into pass/fail.

Fails loud: if any case's API call errors, the whole run raises rather than
report a partial result — a run over fewer cases than expected is a
different, incomparable denominator, not a smaller version of the same
measurement.

Run: python -m app.cli eval-verdict [--runs N]
"""
import asyncio
import json
import logging
from pathlib import Path

from app.config import Settings
from app.services import match_client

logger = logging.getLogger(__name__)

GOLDEN_SET_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "golden-set.json"

# Space calls out under the "match" rate-limit bucket (10/min) — 11 cases at
# 3s apart stays comfortably inside a minute even accounting for call latency.
PACING_SECONDS = 3.0

VERDICT_BAND: dict[str, str] = {
    "STRONG_YES": "strong",
    "YES": "strong",
    "MAYBE": "weak",
    "NO": "reject",
    "STRONG_NO": "reject",
}
UNSCOREABLE_LABEL = "Unscoreable (unrecognized verdict)"


def load_golden_set() -> list[dict]:
    data = json.loads(GOLDEN_SET_PATH.read_text(encoding="utf-8"))
    return data["cases"]


def classify(verdict: str | None) -> str:
    """Map a raw 6-value verdict to the golden set's 3-band vocabulary, or
    the sentinel "unscoreable" for INSUFFICIENT_DATA / anything unrecognized."""
    return VERDICT_BAND.get((verdict or "").strip(), "unscoreable")


async def run_eval(settings: Settings, cases: list[dict] | None = None) -> list[dict]:
    """Score every golden-set case sequentially (paced) and return one result
    dict per case. Raises RuntimeError immediately if any call fails — never
    returns a partial result."""
    cases = cases if cases is not None else load_golden_set()
    results = []
    for i, case in enumerate(cases):
        if i > 0:
            await asyncio.sleep(PACING_SECONDS)
        response = await match_client.score_job(settings, case["jdText"])
        if response is None:
            raise RuntimeError(
                f"eval-verdict: API call failed for case '{case['id']}' — "
                "aborting the whole run rather than reporting a partial result."
            )
        verdict = response.get("verdict")
        band = classify(verdict)
        results.append({
            "id": case["id"],
            "title": case.get("title"),
            "expected": case["expected"],
            "uncertain": bool(case.get("uncertain", False)),
            "tags": case.get("tags") or [],
            "verdict": verdict,
            "overallScore": response.get("overallScore"),
            "band": band,
            "passed": band == case["expected"],
        })
    return results


def format_report(results: list[dict]) -> str:
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    certain = [r for r in results if not r["uncertain"]]
    uncertain = [r for r in results if r["uncertain"]]

    lines = [
        f"Evaluator golden-set report — {passed}/{total} passed",
    ]
    if certain:
        c_passed = sum(1 for r in certain if r["passed"])
        lines.append(f"  Certain cases:   {c_passed}/{len(certain)} passed")
    if uncertain:
        u_passed = sum(1 for r in uncertain if r["passed"])
        lines.append(f"  Uncertain cases: {u_passed}/{len(uncertain)} passed (reported separately, still counted above)")
    lines.append("")

    unscoreable = [r for r in results if r["band"] == "unscoreable"]
    if unscoreable:
        lines.append(UNSCOREABLE_LABEL + ":")
        for r in unscoreable:
            lines.append(f"  {r['id']}: {r['title']} — verdict={r['verdict']}")
        lines.append("")

    failures = [r for r in results if not r["passed"]]
    if failures:
        lines.append("FAILURES, grouped by tag:")
        by_tag: dict[str, list[dict]] = {}
        for r in failures:
            for tag in (r["tags"] or ["(untagged)"]):
                by_tag.setdefault(tag, []).append(r)
        for tag in sorted(by_tag):
            lines.append(f"  [{tag}]")
            for r in by_tag[tag]:
                flag = " (uncertain)" if r["uncertain"] else ""
                lines.append(
                    f"    {r['id']}: expected {r['expected']}, got {r['band']} "
                    f"(verdict={r['verdict']}, score={r['overallScore']}){flag} — {r['title']}"
                )
        lines.append("")
    else:
        lines.append("No failures.")

    return "\n".join(lines)


def format_multi_run_report(all_results: list[list[dict]]) -> str:
    """Noise-baseline report across N repeated runs of the same case set:
    aggregate pass-rate spread, plus per-case flakiness (a case whose
    pass/fail outcome changed across runs)."""
    n_runs = len(all_results)
    total = len(all_results[0]) if all_results else 0
    pass_rates = [sum(1 for r in run if r["passed"]) for run in all_results]

    lines = [
        f"Evaluator golden-set — {n_runs} runs x {total} cases",
        f"Pass rates: {pass_rates} (spread: {max(pass_rates) - min(pass_rates)} / {total})",
        "",
    ]

    by_id: dict[str, list[dict]] = {}
    for run in all_results:
        for r in run:
            by_id.setdefault(r["id"], []).append(r)

    flaky = [
        (case_id, runs) for case_id, runs in by_id.items()
        if len({r["passed"] for r in runs}) > 1
    ]
    if flaky:
        lines.append("FLAKY cases (pass/fail outcome changed across runs):")
        for case_id, runs in flaky:
            outcomes = ["pass" if r["passed"] else "fail" for r in runs]
            lines.append(f"  {case_id}: {outcomes} — {runs[0]['title']}")
        lines.append("")
    else:
        lines.append("No flaky cases — every case's pass/fail outcome was identical across all runs.")
        lines.append("")

    lines.append("Per-run reports:")
    for i, run in enumerate(all_results, start=1):
        lines.append(f"--- run {i}/{n_runs} ---")
        lines.append(format_report(run))

    return "\n".join(lines)
