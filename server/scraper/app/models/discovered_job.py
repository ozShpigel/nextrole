from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class DiscoveredJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    run_id: str
    # None for shared-pool jobs: the pool is not driven by a saved search.
    criteria_id: str | None = None
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
    # scraper never fills numEmployees though (only Indeed does), so pool jobs
    # carry that gap. The DDG-based backfill that used to close it belonged to
    # the criteria-driven ingest and went with it (docs/scraper-slimming.md).
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
    # Retention marker: criteria-driven jobs are purged by the TTL index after
    # 60 days; shared-pool jobs opt out (pool.py sets this False) because an
    # expired pool listing is marked inactive, never deleted. See indexes.py.
    # Default False since the criteria path went (docs/scraper-slimming.md):
    # pool rows are the only rows anyone creates now, and a True default means
    # a construction site that forgets the flag hands a pool job to the 60-day
    # TTL index -- deleting a listing the pool guarantees to keep and only mark
    # inactive. `_backfill_ttl_managed` still stamps True, but only on rows with
    # no pool_key, and it writes to Mongo directly rather than through here.
    ttl_managed: bool = False
    # ---- Shared pool (docs/job-pool.md) -------------------------------------
    # Stable identity for a listing across runs: the job_url when the board
    # gives one, otherwise a hash of company+title+date_posted. Unique index.
    pool_key: str | None = None
    # Presence, not quality: a listing stops being active once it has been
    # absent from N consecutive runs. Never deleted — an inactive job is still
    # readable, it just drops out of the default view.
    is_active: bool = True
    missed_runs: int = 0
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_seen_run_id: str | None = None
    # Stated requirements read once, when the job first enters the pool:
    # required_years, must_have_tech, nice_to_have_tech, seniority, domain,
    # location. User-independent by construction (no profile is read and
    # nothing is scored), so it is computed once and reused for every user —
    # never recomputed per user. None = extraction still owed (a failed or
    # skipped call), which the next run retries.
    extracted: dict | None = None
    extracted_at: datetime | None = None
    # Bounded retry: incremented on every extraction attempt, successful or
    # not. At MAX_EXTRACT_ATTEMPTS the job is left unextracted for good rather
    # than billing a Claude call a day for a posting nothing can parse.
    extract_attempts: int = 0

    # The ingest's Analyst read of this posting: the structured document the
    # Evaluator scores against, computed once for everybody instead of once per
    # user. Null means the per-user scan parses it inline (a job predating this,
    # or one whose ingest parse failed) -- never a reason to hide the job.
    parsed: dict | None = None
    parsed_at: datetime | None = None
    # Stamp of the prompt+model+temperature that produced `parsed`. A different
    # value means STALE, not wrong: the parse is still used and the backfill
    # replaces it in its own time. See ParseVersioning on the API side.
    parsed_with: str | None = None
    # Share of job-facts' must-have technologies the parse mentions anywhere the
    # Evaluator can see (app/services/parse_quality.py). None when not
    # measurable -- no parse, or the posting states no required tech. Low values
    # mark a parse that missed stated requirements; stored, not blocked.
    parse_coverage: float | None = None
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
