"""Integrity checks for the demo seed postings and doc construction."""
from app.services.demo_seed import POSTINGS, SEED_MARKER, SEED_RUN_ID, build_seed_docs
from app.services.embeddings import EMBEDDING_MODEL


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


def test_build_seed_docs_pairs_vectors_and_marks_docs():
    vectors: list[list[float] | None] = [[0.1, 0.2]] * (len(POSTINGS) - 1) + [None]
    docs = build_seed_docs(vectors)
    assert len(docs) == len(POSTINGS)
    for doc in docs:
        assert doc[SEED_MARKER] is True
        assert doc["run_id"] == SEED_RUN_ID
        assert doc["site"] == "demo"
        assert doc["discovered_at"] is not None
    assert docs[0]["job_embedding"] == [0.1, 0.2]
    assert docs[0]["embedding_model"] == EMBEDDING_MODEL
    # A failed embedding stays visible in the doc but invisible to search.
    assert docs[-1]["job_embedding"] is None
    assert docs[-1]["embedding_model"] is None
