"""Integrity checks for the demo seed postings and doc construction."""
from app.services.demo_seed import POSTINGS, SEED_MARKER, SEED_RUN_ID, build_seed_docs


def test_postings_are_well_formed_and_unique():
    assert len(POSTINGS) >= 20  # enough for a limit-15 search to feel real
    urls = [p["job_url"] for p in POSTINGS]
    assert len(urls) == len(set(urls)), "job_url must be unique per posting"
    for p in POSTINGS:
        assert p["title"].strip() and p["company"].strip()
        assert p["description"].strip(), f"empty description: {p['title']}"
        # Fictional URLs only — never a real board.
        assert p["job_url"].startswith("https://careers.demo-nextrole.example/")


def test_postings_cover_levels_for_the_seniority_filter():
    levels = {p["job_level"] for p in POSTINGS}
    assert "mid-senior level" in levels
    assert "entry level" in levels


def _fake_response(score: int, verdict: str) -> dict:
    return {
        "overallScore": score, "verdict": verdict,
        "recommendation": {"shouldApply": score >= 70},
        "breakdown": {}, "honestAssessment": "",
        "analystSnapshotInput": "in", "analystSnapshotOutput": "out",
        "evaluatorSnapshotInput": "ein", "evaluatorSnapshotOutput": "eout",
    }


def test_build_seed_docs_marks_docs_and_applies_scores():
    scored_url = POSTINGS[0]["job_url"]
    scores = {scored_url: _fake_response(82, "YES")}
    docs = build_seed_docs(scores)
    assert len(docs) == len(POSTINGS)

    by_url = {d["job_url"]: d for d in docs}
    scored_doc = by_url[scored_url]
    assert scored_doc["score"] == 82
    assert scored_doc["verdict"] == "YES"
    assert scored_doc["should_apply"] is True
    assert scored_doc["analyst_snapshot_input"] == "in"
    assert scored_doc["evaluator_snapshot_output"] == "eout"
    # Snapshots live in their own columns — not duplicated inside match_analysis.
    assert "analystSnapshotInput" not in scored_doc["match_analysis"]
    assert "evaluatorSnapshotOutput" not in scored_doc["match_analysis"]
    assert scored_doc["match_analysis"]["overallScore"] == 82

    for doc in docs:
        assert doc[SEED_MARKER] is True
        assert doc["run_id"] == SEED_RUN_ID
        assert doc["site"] == "demo"
        assert doc["discovered_at"] is not None

    # Postings absent from `scores` (their batch failed) stay unscored, not dropped.
    unscored = [d for d in docs if d["job_url"] != scored_url]
    assert len(unscored) == len(POSTINGS) - 1
    assert all(d["score"] is None for d in unscored)
