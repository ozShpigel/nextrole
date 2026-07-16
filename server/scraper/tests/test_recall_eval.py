"""Bucket classification and recall@K math for the golden-set recall eval.

Pure logic only — the Mongo/$vectorSearch/OpenAI plumbing is exercised
manually via `python -m app.cli eval-recall`.
"""
from app.services.recall_eval import evaluate, format_report


def _app(url: str, title: str = "Engineer") -> dict:
    return {"job_url": url, "title": title, "company": "Acme",
            "status": "Applied", "created_at": None}


def _ranked(*urls: str) -> list[dict]:
    return [{"job_url": u, "similarity": 0.9 - i * 0.01} for i, u in enumerate(urls)]


def test_buckets_and_recall():
    golden = [_app("u-top"), _app("u-deep"), _app("u-triaged"), _app("u-gone")]
    # u-top at rank 1; u-deep at rank 20 (behind 18 filler hits).
    ranked = _ranked("u-top", *[f"filler-{i}" for i in range(18)], "u-deep")
    pool = {
        "u-top": {"embedded": True, "triaged_out": False},
        "u-deep": {"embedded": True, "triaged_out": False},
        "u-triaged": {"embedded": False, "triaged_out": True},
    }
    ev = evaluate(golden, ranked, pool, ks=(15, 30))

    by_url = {r["job_url"]: r for r in ev["results"]}
    assert by_url["u-top"]["bucket"] == "ranked" and by_url["u-top"]["rank"] == 1
    assert by_url["u-deep"]["rank"] == 20
    assert by_url["u-triaged"]["bucket"] == "not_embedded"
    assert by_url["u-triaged"]["triaged_out"] is True
    assert by_url["u-gone"]["bucket"] == "not_in_pool"

    # Measurable = u-top + u-deep; only u-top makes the top 15.
    assert ev["measurable"] == 2
    assert ev["recall"][15] == 0.5
    assert ev["recall"][30] == 1.0


def test_duplicate_url_keeps_best_rank():
    ev = evaluate(
        [_app("dup")],
        _ranked("other", "dup") + [{"job_url": "dup", "similarity": 0.1}],
        {"dup": {"embedded": True, "triaged_out": False}},
    )
    assert ev["results"][0]["rank"] == 2


def test_embedded_but_beyond_ranked_window():
    ev = evaluate(
        [_app("u")], [], {"u": {"embedded": True, "triaged_out": False}}, ks=(15,))
    assert ev["results"][0]["bucket"] == "beyond_window"
    # Measurable (it has an embedding) but never ranked — counts as a miss.
    assert ev["measurable"] == 1
    assert ev["recall"][15] == 0.0


def test_no_measurable_jobs_has_no_recall():
    ev = evaluate([_app("gone")], _ranked("other"), {}, ks=(15,))
    assert ev["measurable"] == 0
    assert ev["recall"][15] is None


def test_format_report_smoke():
    golden = [_app("u-top", title="DevEx Lead"), _app("u-gone", title="Old Role")]
    ev = evaluate(golden, _ranked("u-top"),
                  {"u-top": {"embedded": True, "triaged_out": False}}, ks=(15,))
    report = format_report(ev, pool_count=42)
    assert "Recall@15: 1/1 (100%)" in report
    assert "DevEx Lead" in report and "Old Role" in report
    assert "NOT IN POOL" in report
