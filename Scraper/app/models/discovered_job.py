from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class DiscoveredJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    run_id: str
    criteria_id: str
    # From JobSpy
    title: str
    company: str
    location: str | None = None
    description: str | None = None
    job_url: str | None = None
    date_posted: str | None = None
    site: str = "linkedin"
    # From JobMatchService (rich MatchResponse is stored in match_analysis;
    # score/verdict/should_apply are copied out for sorting/filtering).
    score: int | None = None
    verdict: str | None = None
    should_apply: bool | None = None
    match_analysis: dict | None = None
    # Raw Claude call artifacts — null for the Analyst pair on scraper-
    # discovered jobs because we pass title/company from JobSpy and skip
    # the Analyst call entirely.
    analyst_snapshot_input: str | None = None
    analyst_snapshot_output: str | None = None
    evaluator_snapshot_input: str | None = None
    evaluator_snapshot_output: str | None = None
    # Company enrichment (news headlines + Glassdoor rating)
    company_news: list[dict] | None = None
    glassdoor_data: dict | None = None
    # Tracking
    is_duplicate: bool = False
    saved_to_tracker: bool = False
    dismissed: bool = False
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
