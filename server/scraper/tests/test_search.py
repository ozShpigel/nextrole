"""Unit tests for the $vectorSearch pipeline composition (pure function)."""
from datetime import datetime, timedelta, timezone

from app.services.search import OVERFETCH_FACTOR, VECTOR_INDEX_NAME, _dedupe_by_url, build_vector_pipeline

VEC = [0.1] * 4  # dimensionality is irrelevant to pipeline shape


def vs(pipeline: list[dict]) -> dict:
    return pipeline[0]["$vectorSearch"]


def test_minimal_pipeline_shape():
    p = build_vector_pipeline(VEC, limit=10, days_back=14)
    assert vs(p)["index"] == VECTOR_INDEX_NAME
    assert vs(p)["path"] == "job_embedding"
    assert vs(p)["queryVector"] == VEC
    assert vs(p)["limit"] == 10 * OVERFETCH_FACTOR
    assert vs(p)["numCandidates"] >= vs(p)["limit"]
    # score surfaced, embedding stripped from results
    assert p[1] == {"$addFields": {"similarity": {"$meta": "vectorSearchScore"}}}
    assert p[2] == {"$project": {"_id": 0, "job_embedding": 0}}


def test_date_cutoff_matches_days_back():
    p = build_vector_pipeline(VEC, limit=5, days_back=7)
    conds = vs(p)["filter"]["$and"]
    cutoff = conds[0]["discovered_at"]["$gte"]
    expected = datetime.now(timezone.utc) - timedelta(days=7)
    assert abs((cutoff - expected).total_seconds()) < 5


def test_optional_filters_are_omitted_by_default():
    p = build_vector_pipeline(VEC, limit=5, days_back=7)
    conds = vs(p)["filter"]["$and"]
    assert len(conds) == 1  # date range only


def test_all_filters_compose():
    p = build_vector_pipeline(
        VEC, limit=5, days_back=7,
        is_remote=True, job_levels=["director"], sites=["linkedin"],
    )
    conds = vs(p)["filter"]["$and"]
    assert {"is_remote": True} in conds
    assert {"job_level": {"$in": ["director"]}} in conds
    assert {"site": {"$in": ["linkedin"]}} in conds


def test_is_remote_false_is_a_filter_not_omitted():
    p = build_vector_pipeline(VEC, limit=5, days_back=7, is_remote=False)
    assert {"is_remote": False} in vs(p)["filter"]["$and"]


def test_num_candidates_floor():
    p = build_vector_pipeline(VEC, limit=1, days_back=7)
    assert vs(p)["numCandidates"] == 200  # max(200, 3 * 15)


def test_dedupe_by_url_keeps_first_and_urlless():
    hits = [
        {"id": "1", "job_url": "https://x/a"},
        {"id": "2", "job_url": "https://x/a"},
        {"id": "3", "job_url": None},
        {"id": "4", "job_url": "https://x/b"},
    ]
    assert [h["id"] for h in _dedupe_by_url(hits)] == ["1", "3", "4"]
