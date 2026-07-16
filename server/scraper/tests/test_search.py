"""Unit tests for the $vectorSearch pipeline composition and the multi-facet
Reciprocal Rank Fusion (pure functions)."""
from datetime import datetime, timedelta, timezone

from app.services.search import (
    OVERFETCH_FACTOR,
    VECTOR_INDEX_NAME,
    build_vector_pipeline,
    fuse_rankings,
)

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


def _hit(url: str, sim: float) -> dict:
    return {"id": f"id-{url}", "job_url": url, "similarity": sim}


def test_fuse_single_facet_preserves_order_and_dedupes():
    hits = [_hit("a", 0.9), _hit("a", 0.8), _hit("b", 0.7), {"id": "no-url", "job_url": None, "similarity": 0.6}]
    fused = fuse_rankings([("only", hits)])
    # Duplicate url collapses; urlless hit keyed by id survives.
    assert [h.get("job_url") for h in fused] == ["a", "b", None]
    assert fused[0]["facet_ranks"] == {"only": 1}


def test_fuse_rrf_scoring_invariants():
    # "specialist" is #1 in one facet only; "generalist" is #3 in both;
    # "x" is #2 in one facet only.
    backend = [_hit("specialist", 0.9), _hit("x", 0.8), _hit("generalist", 0.7)]
    devops = [_hit("y", 0.85), _hit("z", 0.8), _hit("generalist", 0.75)]
    fused = fuse_rankings([("backend", backend), ("devops", devops)])
    order = [h["job_url"] for h in fused]
    # RRF invariants: appearing in two facets accumulates (2/63 > 1/61), and a
    # single #1 still beats a single #2 (1/61 > 1/62).
    assert order.index("generalist") < order.index("specialist")
    assert order.index("specialist") < order.index("x")
    assert fused[0]["facet_ranks"] == {"backend": 3, "devops": 3}


def test_fuse_carries_best_similarity_across_facets():
    fused = fuse_rankings([
        ("backend", [_hit("a", 0.70)]),
        ("devops", [_hit("a", 0.82)]),
    ])
    assert fused[0]["similarity"] == 0.82
    assert fused[0]["facet_ranks"] == {"backend": 1, "devops": 1}
