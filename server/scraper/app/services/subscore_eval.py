"""Golden-set sub-score evaluation for the Evaluator (`POST /api/match`).

Unlike verdict_eval (which checks the overall verdict against a single
expected band), this checks individual `breakdown.*.score` dimensions
against a frozen candidate profile — so a failing case means the prompt
changed, not that the live Mongo profile changed underneath the eval.

Each case names the dimension(s) it cares about in `expected`
(e.g. {"technicalFit": "high"}) and is scored via `score_job(..., profile=...)`
with the frozen profile loaded from tests/fixtures/golden-profile.json on
every call. Dimensions not named in a case's `expected` are read (and
reported, for reference) but never compared.

Fails loud, same as verdict_eval: if any case's API call errors, the whole
run raises rather than report a partial result.

Run: python -m app.cli eval-subscore
"""
import json
import asyncio
import logging
from pathlib import Path

from app.config import Settings
from app.services import match_client
from app.services.verdict_eval import load_golden_set

logger = logging.getLogger(__name__)

GOLDEN_PROFILE_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "golden-profile.json"

# Same bucket as verdict_eval — /api/match is rate-limited under "match" (10/min).
PACING_SECONDS = 3.0

DIMENSIONS = ["technicalFit", "engineeringExecutionFit", "sustainabilityPaceFit"]

# Band a sub-score by percentage of its own maxScore (not a hardcoded point
# value — maxScore is model-reported and, per PromptSeeds, dimension-specific).
BAND_LOW_CEILING = 28   # < 28%  -> low
BAND_MID_CEILING = 57   # 28-57% -> mid; > 57% -> high


def load_golden_profile() -> dict:
    return json.loads(GOLDEN_PROFILE_PATH.read_text(encoding="utf-8"))


def band_for(score: int | None, max_score: int | None) -> str | None:
    """None when the response didn't carry a usable score/maxScore pair —
    kept distinct from a real band so a missing dimension never silently
    reads as a pass or a specific band."""
    if score is None or not max_score:
        return None
    pct = (score / max_score) * 100
    if pct < BAND_LOW_CEILING:
        return "low"
    if pct <= BAND_MID_CEILING:
        return "mid"
    return "high"


async def run_eval(settings: Settings, cases: list[dict] | None = None) -> list[dict]:
    """Score every golden-set case sequentially (paced) against the frozen
    golden-profile.json and return one result dict per case. Raises
    RuntimeError immediately if any call fails — never returns a partial
    result (same contract as verdict_eval.run_eval)."""
    cases = cases if cases is not None else load_golden_set()
    profile = load_golden_profile()
    results = []
    for i, case in enumerate(cases):
        if i > 0:
            await asyncio.sleep(PACING_SECONDS)
        response = await match_client.score_job(settings, case["jdText"], profile=profile)
        if response is None:
            raise RuntimeError(
                f"eval-subscore: API call failed for case '{case['id']}' — "
                "aborting the whole run rather than reporting a partial result."
            )

        breakdown = response.get("breakdown") or {}
        observed = {}
        for dim in DIMENSIONS:
            d = breakdown.get(dim) or {}
            score, max_score = d.get("score"), d.get("maxScore")
            observed[dim] = {"score": score, "maxScore": max_score, "band": band_for(score, max_score)}

        hard_blockers = response.get("hardBlockers") or []
        expect_no_blockers = bool(case.get("expectNoBlockers", False))
        no_blockers_ok = not (expect_no_blockers and hard_blockers)

        # expectBlocked is the inverse, tri-state check: True/False actually
        # assert on hardBlockers being non-empty/empty; absent (None) means no
        # opinion from this flag (expectNoBlockers, above, still applies on
        # its own). Cases that test the veto itself carry no `expected` dict.
        expect_blocked = case.get("expectBlocked")
        if expect_blocked is None:
            blocked_ok = True
        else:
            blocked_ok = bool(hard_blockers) == bool(expect_blocked)

        blockers_ok = no_blockers_ok and blocked_ok

        expected = case.get("expected") or {}
        checked = []
        for dim, expected_band in expected.items():
            actual = observed.get(dim, {"score": None, "maxScore": None, "band": None})
            checked.append({
                "dimension": dim,
                "expectedBand": expected_band,
                "actualBand": actual["band"],
                "score": actual["score"],
                "maxScore": actual["maxScore"],
                "passed": actual["band"] == expected_band,
            })

        results.append({
            "id": case["id"],
            "title": case.get("title"),
            "probe": case.get("probe"),
            "signal": case.get("signal"),
            "blocker": case.get("blocker"),
            "dependsOnProfile": bool(case.get("dependsOnProfile", False)),
            "checked": checked,
            "expectNoBlockers": expect_no_blockers,
            "expectBlocked": expect_blocked,
            "hardBlockers": hard_blockers,
            "blockersOk": blockers_ok,
            "observed": observed,
            "passed": blockers_ok and all(c["passed"] for c in checked),
        })
    return results


def format_report(results: list[dict]) -> str:
    total = len(results)
    passed = sum(1 for r in results if r["passed"])

    lines = [
        f"Evaluator sub-score golden-set report — {passed}/{total} passed",
        "",
    ]

    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        header = f"[{status}] {r['id']}"
        if r.get("title"):
            header += f" — {r['title']}"
        meta = [f"{k}={r[k]}" for k in ("probe", "signal", "blocker") if r.get(k)]
        if meta:
            header += f" ({', '.join(meta)})"
        lines.append(header)

        if r["checked"]:
            for c in r["checked"]:
                mark = "OK" if c["passed"] else "MISMATCH"
                lines.append(
                    f"    {c['dimension']}: expected={c['expectedBand']} actual={c['actualBand']} "
                    f"({c['score']}/{c['maxScore']}) {mark}"
                )
        elif not (r["expectNoBlockers"] or r["expectBlocked"] is not None):
            lines.append("    (no dimensions named in `expected`)")

        # expectNoBlockers/expectBlocked are independent checks (both may be
        # declared, though normally only one is); report whichever fired.
        if r["expectNoBlockers"] or r["expectBlocked"] is not None:
            expectation = "blocked" if r["expectBlocked"] else "not blocked"
            actual = "blocked" if r["hardBlockers"] else "not blocked"
            mark = "OK" if r["blockersOk"] else "MISMATCH"
            lines.append(f"    blockers: expected={expectation} actual={actual} {mark}")

        # Surface the model's own reasoning whenever a blocker actually fired,
        # regardless of whether this case declared an expectation about it.
        if r["hardBlockers"]:
            for b in r["hardBlockers"]:
                lines.append(f"      - {b}")

        observed_str = " ".join(
            f"{dim}={o['score']}/{o['maxScore']}" for dim, o in r["observed"].items()
        )
        lines.append(f"    observed: {observed_str}")
        lines.append("")

    failures = [r for r in results if not r["passed"]]
    if not failures:
        lines.append("No failures.")

    return "\n".join(lines)
