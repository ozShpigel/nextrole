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
    job_level: str | None = None  # jobspy "job_level" (LinkedIn-populated; null elsewhere)
    # AI-classified seniority band (source-agnostic, judged from the posting's
    # own title+description) — replaces reliance on job_level above, which is
    # LinkedIn-only and frequently missing/wrong. One of the five JOB_LEVELS
    # client vocabulary strings, or None when the classifier wasn't confident
    # (never excludes — see PromptSeeds.SeniorityClassification).
    actual_job_level: str | None = None
    is_remote: bool | None = None  # jobspy "is_remote"
    company_logo: str | None = None  # jobspy "company_logo" — not always present
    # Company profile fields jobspy captures on every scrape (industry, size,
    # revenue, description, url) — free, no extra HTTP call. jobspy's LinkedIn
    # scraper never fills numEmployees though (only Indeed does), so relevant
    # jobs get that one gap backfilled from company_size_client's DDG-based
    # prefetch (see orchestrator._enrich_company_profile) before scoring.
    company_profile: dict | None = None
    # Per-job Evaluator score, populated by the batched-scoring ingest step.
    # None = not yet scored, scoring failed, or the job was triaged out.
    # (rich MatchResponse is stored in match_analysis; score/verdict/should_apply
    # are copied out for sorting/filtering).
    score: int | None = None
    verdict: str | None = None
    should_apply: bool | None = None
    match_analysis: dict | None = None
    # Raw Claude call artifacts from the Analyst+Evaluator pair.
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
    # Title triage: dropped before scoring as clearly off-target for the
    # search intent (one Haiku call per run; never scored or enriched).
    triaged_out: bool = False
    triage_reason: str | None = None
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
