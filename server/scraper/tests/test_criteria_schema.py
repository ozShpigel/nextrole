"""The titles × locations search budget — each pair is one job-board search
per run; the cap keeps a single criteria from burst-scraping LinkedIn into a
rate-limit block."""
import pytest
from pydantic import ValidationError

from app.schemas.criteria import (
    MAX_SEARCHES_PER_RUN,
    CreateCriteriaRequest,
    search_pairs,
)


def _req(titles: list[str], locations: list[str]) -> CreateCriteriaRequest:
    return CreateCriteriaRequest(name="t", job_titles=titles, locations=locations)


def test_within_budget_accepted():
    req = _req([f"t{i}" for i in range(6)], ["Tel Aviv", "Remote"])  # 12 pairs
    assert search_pairs(req.job_titles, req.locations) == MAX_SEARCHES_PER_RUN


def test_over_budget_rejected():
    with pytest.raises(ValidationError, match="exceeds the limit"):
        _req([f"t{i}" for i in range(7)], ["Tel Aviv", "Remote"])  # 14 pairs


def test_no_locations_counts_as_one():
    # 12 titles × no location = 12 searches — exactly at the budget.
    req = _req([f"t{i}" for i in range(MAX_SEARCHES_PER_RUN)], [])
    assert search_pairs(req.job_titles, req.locations) == MAX_SEARCHES_PER_RUN
    with pytest.raises(ValidationError):
        _req([f"t{i}" for i in range(MAX_SEARCHES_PER_RUN + 1)], [])
