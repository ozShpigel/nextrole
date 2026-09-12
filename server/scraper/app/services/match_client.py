import logging

from app.config import Settings
from app.services.tracker_client import _request_with_retry

logger = logging.getLogger(__name__)


async def triage_titles(
    settings: Settings,
    search_intent: str,
    jobs: list[dict],
) -> dict[str, dict] | None:
    """One Haiku call per run: flags scraped titles that are clearly off-target
    for the search intent (job-board padding), before any embedding.

    Returns {job_id: {"relevant": bool, "reason": str | None}}, or None on
    any failure — the caller MUST fail open (keep every job) on None.

    Correlates results by jobId (assigned at scrape time), not list
    position. A response that fails outright (bad status, unparseable body)
    still fails open. A response that parses but can't be correlated by
    jobId is a version mismatch (an API still on the old index-based
    contract) — that raises instead of silently falling back to positional
    matching, per the CD pipeline's independent-deploy skew window."""
    if not search_intent or not jobs:
        return None
    titles = [
        {"jobId": j["id"], "title": j.get("title") or "", "company": j.get("company") or None}
        for j in jobs
    ]
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/title-triage",
        settings=settings,
        timeout=120.0,
        operation="title-triage",
        retry_on_timeout=False,
        json={"searchIntent": search_intent, "titles": titles},
    )
    # error, not warning: keeping all jobs roughly doubles how many reach the
    # paid Evaluator, so this is a cost event, not a degraded-quality event.
    if resp is None or resp.status_code != 200:
        logger.error("Title triage failed (%s) — keeping all jobs, every one will be scored",
                     resp.status_code if resp is not None else "no response")
        return None
    try:
        results = (resp.json() or {}).get("results") or []
    except Exception as e:
        logger.error("Title triage response unparseable (%s) — keeping all jobs, every one will be scored", e)
        return None
    if results and not all(isinstance(r, dict) and r.get("jobId") for r in results):
        raise RuntimeError(
            "Title triage response missing jobId — API/scraper version mismatch"
        )
    triage = {
        r["jobId"]: {"relevant": bool(r.get("relevant", True)), "reason": r.get("reason")}
        for r in results
    }
    dropped = sum(1 for v in triage.values() if not v["relevant"])
    logger.info("Title triage: %d/%d titles kept for intent '%s'",
                len(jobs) - dropped, len(jobs), search_intent)
    return triage


async def classify_seniority(settings: Settings, jobs: list[dict]) -> dict[str, str | None] | None:
    """One Haiku call per run: classifies each relevant scraped job's actual
    seniority band from title+description — source-agnostic, unlike jobspy's
    LinkedIn-only job_level tag.

    Returns {job_id: level | None}, or None on any failure — the caller
    MUST fail open (actual_job_level stays None everywhere, which never
    excludes) on None.

    Correlates results by jobId (assigned at scrape time), not list
    position — see triage_titles for the version-mismatch rationale."""
    if not jobs:
        return None
    items = [
        {"jobId": j["id"], "title": j.get("title") or "", "description": j.get("description")}
        for j in jobs
    ]
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/seniority-classify",
        settings=settings,
        timeout=120.0,
        operation="seniority-classify",
        retry_on_timeout=False,
        json={"jobs": items},
    )
    if resp is None or resp.status_code != 200:
        logger.warning("Seniority classification failed (%s) — leaving actual_job_level unset",
                       resp.status_code if resp is not None else "no response")
        return None
    try:
        results = (resp.json() or {}).get("results") or []
    except Exception as e:
        logger.warning("Seniority classification response unparseable (%s) — leaving actual_job_level unset", e)
        return None
    if results and not all(isinstance(r, dict) and r.get("jobId") for r in results):
        raise RuntimeError(
            "Seniority classification response missing jobId — API/scraper version mismatch"
        )
    levels = {r["jobId"]: r.get("level") for r in results}
    labeled = sum(1 for v in levels.values() if v)
    logger.info("Seniority classification: %d/%d jobs labeled", labeled, len(jobs))
    return levels


async def score_job(settings: Settings, job_description: str, profile: dict | None = None) -> dict | None:
    """One Analyst+Evaluator call pair against a single job description —
    the same path the manual "Score a Job" page uses (`POST /api/match`,
    jobDescription only, letting the Analyst extract title/company).

    `profile`, when given, is a StructuredProfile dict scored against instead
    of whatever is currently stored server-side (see MatchRequest.Profile) —
    used by the golden-set eval to score against a frozen profile.

    Returns the raw MatchResponse dict, or None on any failure.
    """
    if not job_description:
        return None
    payload = {"jobDescription": job_description}
    if profile:
        payload["profile"] = profile
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match",
        settings=settings,
        timeout=180.0,
        operation="score-job",
        retry_on_timeout=False,
        json=payload,
    )
    if resp is not None and resp.status_code == 200:
        return resp.json()
    logger.error("Score-job call failed (%s)",
                 resp.status_code if resp is not None else "no response")
    return None


async def score_job_batch(settings: Settings, jobs: list[dict], run_id: str | None = None) -> dict[str, dict] | None:
    """Scores up to 5 jobs in ONE Evaluator call — the primary ingest-time
    scoring path (`POST /api/match/discovery-score-batch`). Each job is still
    scored independently against the fixed rubric; batching only shares the
    Evaluator call's input cost, never compares jobs to each other.

    Each item in `jobs` needs: id, jobDescription, and the same optional
    fields as `score_job` plus companyNews/glassdoorData/companyProfile.

    run_id: the discovery run this batch belongs to, if any (omitted for
    non-discovery callers like Import Job) — carried through to the API's
    "Job scored" log line so a job can be traced end-to-end in Loki.

    Returns {id: MatchResponse dict}, or None on any failure — the caller
    MUST fail open (store the whole batch unscored, retry next cycle) on
    None, matching the "batches are small, don't retry at single-job
    granularity" simplicity principle.
    """
    if not jobs:
        return None
    payload = {"jobs": jobs}
    if run_id:
        payload["runId"] = run_id
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/discovery-score-batch",
        settings=settings,
        timeout=240.0,
        operation="discovery-score-batch",
        retry_on_timeout=False,
        json=payload,
    )
    if resp is None or resp.status_code != 200:
        logger.error("Discovery batch-score call failed (%s)",
                     resp.status_code if resp is not None else "no response")
        return None
    try:
        results = (resp.json() or {}).get("results") or []
        return {r["id"]: r["response"] for r in results if r.get("id") and r.get("response")}
    except Exception as e:
        logger.error("Discovery batch-score response unparseable (%s)", e)
        return None




async def extract_job_facts(settings: Settings, jobs: list[dict]) -> dict[str, dict] | None:
    """One batched Haiku call: read each posting's stated requirements
    (required years, must/nice-to-have tech, seniority, domain, location).

    User-independent by construction — the API endpoint reads no profile and
    scores nothing — which is why the result is stored on the job once and
    reused for every user rather than recomputed per user.

    Returns {job_id: facts}, or None on any failure. The caller must treat a
    missing entry as "extraction still owed" and keep the job: a posting is
    worth more than the facts about it, and the next run retries.

    Correlates by jobId, not list position — same version-mismatch rationale
    as triage_titles.
    """
    if not jobs:
        return None
    items = [
        {
            "jobId": j["id"],
            "title": j.get("title") or "",
            "company": j.get("company"),
            "location": j.get("location"),
            "description": j.get("description"),
        }
        for j in jobs
    ]
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/job-facts",
        settings=settings,
        timeout=180.0,
        operation="job-facts",
        retry_on_timeout=False,
        json={"jobs": items},
    )
    if resp is None or resp.status_code != 200:
        logger.warning("Job-facts extraction failed (%s) — jobs stored without facts, retried next run",
                       resp.status_code if resp is not None else "no response")
        return None
    try:
        results = (resp.json() or {}).get("results") or []
    except Exception as e:
        logger.warning("Job-facts response unparseable (%s) — jobs stored without facts", e)
        return None

    facts = {
        r["jobId"]: {
            "required_years": r.get("requiredYears"),
            "must_have_tech": r.get("mustHaveTech") or [],
            "nice_to_have_tech": r.get("niceToHaveTech") or [],
            "seniority": r.get("seniority"),
            "domain": r.get("domain"),
            "location": r.get("location"),
        }
        for r in results
        if r.get("jobId")
    }
    logger.info("Job facts: %d/%d jobs extracted", len(facts), len(jobs))
    return facts
