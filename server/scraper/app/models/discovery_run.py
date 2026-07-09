from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class DiscoveryRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    criteria_id: str
    criteria_name: str = ""
    # pending | scraping | embedding | completed | failed
    # cancelled (user aborted — terminal; see /runs/{id}/abort)
    # Historic rows may carry retired batch/scoring statuses
    # (scoring | parsing | awaiting_batch | finalizing).
    status: str = "pending"
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    jobs_scraped: int = 0
    jobs_embedded: int = 0
    jobs_embed_failed: int = 0
    jobs_skipped_duplicate: int = 0
    jobs_triaged_out: int = 0  # dropped by AI title triage before embedding
    # Historic counters — per-job scoring/auto-save were retired; kept so
    # pre-migration run rows still render.
    jobs_scored: int = 0
    jobs_saved: int = 0
    error: str | None = None
