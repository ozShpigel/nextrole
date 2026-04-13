from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class DiscoveryRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    criteria_id: str
    criteria_name: str = ""
    status: str = "pending"  # pending | scraping | scoring | completed | failed
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    jobs_scraped: int = 0
    jobs_scored: int = 0
    jobs_saved: int = 0
    jobs_skipped_duplicate: int = 0
    error: str | None = None
