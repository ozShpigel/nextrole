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
    # From Claude scoring
    score: int | None = None
    verdict: str | None = None
    honest_assessment: str | None = None
    key_strengths: list[str] = []
    key_concerns: list[str] = []
    should_apply: bool | None = None
    # Tracking
    is_duplicate: bool = False
    saved_to_tracker: bool = False
    dismissed: bool = False
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
