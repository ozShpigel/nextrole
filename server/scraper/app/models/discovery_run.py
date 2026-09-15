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
    jobs_date_backfilled: int = 0  # already-known job's date_posted refreshed from this scrape
    # Per-search outcomes — throttling visibility. jobspy swallows rate-limit
    # errors, so failed/empty searches are the only signal a run was blocked.
    searches_total: int = 0
    searches_failed: int = 0
    searches_empty: int = 0
    jobs_scored: int = 0  # scored via the batched Evaluator path
    jobs_score_failed: int = 0  # batch call failed — job stored unscored
    # Outcome of the two batched Haiku classification calls — ok | partial |
    # failed | skipped. Both fail open (a job with no verdict is kept and
    # scored), which is the safe direction for relevance and the expensive one
    # for cost. Without these, "nothing was off-target" and "triage never
    # answered" both read as jobs_triaged_out=0: a truncated triage response
    # doubled the number of jobs reaching the Evaluator for twelve days and
    # every run still reported "completed".
    triage_status: str = "skipped"
    triage_unresolved: int = 0  # titles sent that came back without a verdict
    # "not_needed" means extraction banded every job and no classify call was
    # made — the good outcome, deliberately distinct from "skipped" (nothing to
    # do) and from "failed", so a run that stopped calling the classifier does
    # not read as a run whose classifier broke.
    seniority_status: str = "skipped"
    seniority_unresolved: int = 0
    # How many bands came from job-facts rather than a classify call. This is
    # the number that says whether narrowing the classifier is paying off; if
    # it ever collapses, extraction has regressed and the cost comes straight
    # back.
    seniority_from_facts: int = 0
    # Historic — auto-save from the pre-RAG batch-scoring era was retired;
    # kept so pre-migration run rows still render. Not written by the current
    # flow (saving to the Tracker is always an explicit user action).
    jobs_saved: int = 0
    # ---- Shared pool run (docs/job-pool.md) ---------------------------------
    # A pool run folds a scrape into the shared pool rather than producing a
    # user's result set, so its counters are about the pool's shape, not fit.
    jobs_new: int = 0             # first time this listing has been seen
    jobs_extracted: int = 0       # new jobs whose stated requirements were read
    jobs_missed: int = 0          # active pool jobs absent from this run
    jobs_marked_inactive: int = 0 # absent long enough to leave the default view
    jobs_extract_retried: int = 0     # jobs re-attempted because they had no facts
    jobs_extract_abandoned: int = 0   # hit the attempt cap; never retried again
    error: str | None = None
