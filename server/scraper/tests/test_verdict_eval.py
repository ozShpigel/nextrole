"""Verdict-mapping and report-formatting logic for the golden-set Evaluator
eval, plus fail-fast behavior of run_eval.

Pure logic + a mocked API call — no real Mongo/Claude calls. The live tool
is exercised manually via `python -m app.cli eval-verdict`.
"""
import pytest

from app.services import match_client, verdict_eval
from app.services.verdict_eval import (
    classify,
    format_multi_run_report,
    format_report,
    run_eval,
)


def _case(id_, expected, uncertain=False, tags=None):
    return {
        "id": id_, "title": f"Title for {id_}", "jdText": f"JD for {id_}",
        "expected": expected, "why": "because", "uncertain": uncertain,
        "tags": tags or [],
    }


def test_classify_maps_all_six_values():
    assert classify("STRONG_YES") == "strong"
    assert classify("YES") == "strong"
    assert classify("MAYBE") == "weak"
    assert classify("NO") == "reject"
    assert classify("STRONG_NO") == "reject"
    assert classify("INSUFFICIENT_DATA") == "unscoreable"


def test_classify_unrecognized_and_none_are_unscoreable():
    assert classify("garbage") == "unscoreable"
    assert classify(None) == "unscoreable"


@pytest.mark.asyncio
async def test_run_eval_happy_path(monkeypatch):
    cases = [_case("g-01", "strong"), _case("g-02", "reject", tags=["trap"])]
    responses = {
        "g-01": {"verdict": "STRONG_YES", "overallScore": 90},
        "g-02": {"verdict": "MAYBE", "overallScore": 55},  # wrong band -> fail
    }

    async def fake_score_job(settings, jd_text):
        case_id = next(c["id"] for c in cases if c["jdText"] == jd_text)
        return responses[case_id]

    monkeypatch.setattr(match_client, "score_job", fake_score_job)
    monkeypatch.setattr(verdict_eval.asyncio, "sleep", lambda *_: _no_sleep())

    results = await run_eval(settings=object(), cases=cases)

    assert results[0]["passed"] is True and results[0]["band"] == "strong"
    assert results[1]["passed"] is False and results[1]["band"] == "weak"


async def _no_sleep():
    return None


@pytest.mark.asyncio
async def test_run_eval_raises_instead_of_recording_a_partial_result(monkeypatch):
    cases = [_case("g-01", "strong"), _case("g-02", "reject")]
    call_count = {"n": 0}

    async def flaky_score_job(settings, jd_text):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"verdict": "STRONG_YES", "overallScore": 90}
        return None  # simulates an API failure on the second case

    monkeypatch.setattr(match_client, "score_job", flaky_score_job)
    monkeypatch.setattr(verdict_eval.asyncio, "sleep", lambda *_: _no_sleep())

    with pytest.raises(RuntimeError, match="g-02"):
        await run_eval(settings=object(), cases=cases)


def test_format_report_groups_failures_by_tag_and_separates_uncertain():
    results = [
        {"id": "g-01", "title": "A", "expected": "strong", "uncertain": False,
         "tags": [], "verdict": "STRONG_YES", "overallScore": 90, "band": "strong", "passed": True},
        {"id": "g-02", "title": "B", "expected": "reject", "uncertain": False,
         "tags": ["trap"], "verdict": "MAYBE", "overallScore": 55, "band": "weak", "passed": False},
        {"id": "g-04", "title": "D", "expected": "weak", "uncertain": True,
         "tags": ["accumulated-gaps"], "verdict": "MAYBE", "overallScore": 55, "band": "weak", "passed": True},
    ]
    report = format_report(results)
    assert "2/3 passed" in report
    assert "Uncertain cases: 1/1 passed" in report
    assert "[trap]" in report
    assert "g-02" in report and "expected reject, got weak" in report


def test_format_report_lists_unscoreable_separately():
    results = [
        {"id": "g-01", "title": "A", "expected": "strong", "uncertain": False,
         "tags": [], "verdict": "INSUFFICIENT_DATA", "overallScore": None, "band": "unscoreable", "passed": False},
    ]
    report = format_report(results)
    assert "Unscoreable (unrecognized verdict)" in report
    assert "g-01" in report


def test_format_multi_run_report_flags_flaky_cases():
    run1 = [{"id": "g-01", "title": "A", "expected": "strong", "uncertain": False,
             "tags": [], "verdict": "STRONG_YES", "overallScore": 90, "band": "strong", "passed": True}]
    run2 = [{"id": "g-01", "title": "A", "expected": "strong", "uncertain": False,
             "tags": [], "verdict": "MAYBE", "overallScore": 55, "band": "weak", "passed": False}]
    report = format_multi_run_report([run1, run2])
    assert "Pass rates: [1, 0]" in report
    assert "FLAKY cases" in report
    assert "g-01" in report


def test_format_multi_run_report_no_flaky_cases():
    run = [{"id": "g-01", "title": "A", "expected": "strong", "uncertain": False,
            "tags": [], "verdict": "STRONG_YES", "overallScore": 90, "band": "strong", "passed": True}]
    report = format_multi_run_report([run, run])
    assert "No flaky cases" in report
