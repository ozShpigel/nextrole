from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class DiscoveryRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    criteria_id: str
    criteria_name: str = ""
    # pending | scraping | scoring | completed | failed
    # cancelled (user aborted — terminal; see /runs/{id}/abort)
    # Historic rows may carry retired statuses: "embedding" (RAG-era) or
    # parsing | awaiting_batch | finalizing (pre-RAG batch-scoring era).
    status: str = "pending"
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    jobs_scraped: int = 0
    jobs_skipped_duplicate: int = 0
    jobs_triaged_out: int = 0  # dropped by AI title triage before scoring
    jobs_already_known: int = 0  # skipped — job_url already in discovered_jobs from a prior run
    # Per-search outcomes — throttling visibility. jobspy swallows rate-limit
    # errors, so failed/empty searches are the only signal a run was blocked.
    searches_total: int = 0
    searches_failed: int = 0
    searches_empty: int = 0
    jobs_scored: int = 0  # scored via the batched Evaluator path
    jobs_score_failed: int = 0  # batch call failed — job stored unscored
    # Historic — auto-save from the pre-RAG batch-scoring era was retired;
    # kept so pre-migration run rows still render. Not written by the current
    # flow (saving to the Tracker is always an explicit user action).
    jobs_saved: int = 0
    error: str | None = None
