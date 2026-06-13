from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class DiscoveryRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    criteria_id: str
    criteria_name: str = ""
    # live:   pending | scraping | scoring | completed | failed
    # batch:  pending | scraping | parsing | awaiting_batch | finalizing | completed | failed
    status: str = "pending"
    mode: str = "live"  # "live" (synchronous, UI) | "batch" (async, cron)
    batch_id: str | None = None  # Anthropic batch id while status == awaiting_batch
    batch_submitted_at: datetime | None = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    jobs_scraped: int = 0
    jobs_scored: int = 0
    jobs_saved: int = 0
    jobs_skipped_duplicate: int = 0
    error: str | None = None
