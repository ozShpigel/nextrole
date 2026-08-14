import logging

from app.config import Settings
from app.services.tracker_client import _request_with_retry

logger = logging.getLogger(__name__)


async def triage_titles(
    settings: Settings,
    search_intent: str,
    jobs: list[dict],
) -> dict[int, dict] | None:
    """One Haiku call per run: flags scraped titles that are clearly off-target
    for the search intent (job-board padding), before any embedding.

    Returns {job_index: {"relevant": bool, "reason": str | None}}, or None on
    any failure — the caller MUST fail open (keep every job) on None."""
    if not search_intent or not jobs:
        return None
    titles = [
        {"index": i, "title": j.get("title") or "", "company": j.get("company") or None}
        for i, j in enumerate(jobs)
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
    if resp is None or resp.status_code != 200:
        logger.warning("Title triage failed (%s) — keeping all jobs",
                       resp.status_code if resp is not None else "no response")
        return None
    try:
        results = (resp.json() or {}).get("results") or []
        triage = {
            r["index"]: {"relevant": bool(r.get("relevant", True)), "reason": r.get("reason")}
            for r in results
            if isinstance(r.get("index"), int)
        }
    except Exception as e:
        logger.warning("Title triage response unparseable (%s) — keeping all jobs", e)
        return None
    dropped = sum(1 for v in triage.values() if not v["relevant"])
    logger.info("Title triage: %d/%d titles kept for intent '%s'",
                len(jobs) - dropped, len(jobs), search_intent)
    return triage


async def classify_seniority(settings: Settings, jobs: list[dict]) -> dict[int, str | None] | None:
    """One Haiku call per run: classifies each relevant scraped job's actual
    seniority band from title+description — source-agnostic, unlike jobspy's
    LinkedIn-only job_level tag.

    Returns {job_index: level | None}, or None on any failure — the caller
    MUST fail open (actual_job_level stays None everywhere, which never
    excludes) on None."""
    if not jobs:
        return None
    items = [
        {"index": i, "title": j.get("title") or "", "description": j.get("description")}
        for i, j in enumerate(jobs)
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
        levels = {
            r["index"]: r.get("level")
            for r in results
            if isinstance(r.get("index"), int)
        }
    except Exception as e:
        logger.warning("Seniority classification response unparseable (%s) — leaving actual_job_level unset", e)
        return None
    labeled = sum(1 for v in levels.values() if v)
    logger.info("Seniority classification: %d/%d jobs labeled", labeled, len(jobs))
    return levels


async def score_job(settings: Settings, job_description: str) -> dict | None:
    """One Analyst+Evaluator call pair against a single job description —
    the same path the manual "Score a Job" page uses (`POST /api/match`,
    jobDescription only, letting the Analyst extract title/company).

    Returns the raw MatchResponse dict, or None on any failure.
    """
    if not job_description:
        return None
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match",
        settings=settings,
        timeout=120.0,
        operation="score-job",
        retry_on_timeout=False,
        json={"jobDescription": job_description},
    )
    if resp is not None and resp.status_code == 200:
        return resp.json()
    logger.error("Score-job call failed (%s)",
                 resp.status_code if resp is not None else "no response")
    return None


async def score_job_batch(settings: Settings, jobs: list[dict]) -> dict[str, dict] | None:
    """Scores up to 5 jobs in ONE Evaluator call — the primary ingest-time
    scoring path (`POST /api/match/discovery-score-batch`). Each job is still
    scored independently against the fixed rubric; batching only shares the
    Evaluator call's input cost, never compares jobs to each other.

    Each item in `jobs` needs: id, jobDescription, and the same optional
    fields as `score_job` plus companyNews/glassdoorData/companyProfile.

    Returns {id: MatchResponse dict}, or None on any failure — the caller
    MUST fail open (store the whole batch unscored, retry next cycle) on
    None, matching the "batches are small, don't retry at single-job
    granularity" simplicity principle.
    """
    if not jobs:
        return None
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/discovery-score-batch",
        settings=settings,
        timeout=240.0,
        operation="discovery-score-batch",
        retry_on_timeout=False,
        json={"jobs": jobs},
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


async def enrich_narrative(settings: Settings, doc: dict) -> dict | None:
    """On-demand upgrade of a scored job's narrative fields to full detail —
    called once from save_job() when the user clicks Add. Scores/verdict/
    breakdown travel as immutable context; only the 4 narrative fields come
    back.

    Returns the enrichment response dict, or None on any failure — the
    caller MUST fail open (save with the terse content already stored) on
    None, matching the fail-open contract of the other AI-assist calls here.
    """
    analysis = doc.get("match_analysis") or {}
    if analysis.get("overallScore") is None:
        return None
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/enrich-narrative",
        settings=settings,
        timeout=60.0,
        operation="enrich-narrative",
        retry_on_timeout=False,
        json={
            "jobDescription": doc.get("description") or "",
            "title": doc.get("title"),
            "company": doc.get("company"),
            "companyNews": doc.get("company_news"),
            "glassdoorData": doc.get("glassdoor_data"),
            "companyProfile": doc.get("company_profile"),
            "overallScore": analysis.get("overallScore"),
            "verdict": analysis.get("verdict"),
            "breakdown": analysis.get("breakdown"),
            "hardBlockers": analysis.get("hardBlockers") or [],
            "mustClarify": analysis.get("mustClarify") or [],
            "stackedGaps": analysis.get("stackedGaps") or [],
        },
    )
    if resp is None or resp.status_code != 200:
        logger.warning("Narrative enrichment failed (%s) — saving with terse content",
                       resp.status_code if resp is not None else "no response")
        return None
    try:
        return resp.json()
    except Exception as e:
        logger.warning("Narrative enrichment response unparseable (%s) — saving with terse content", e)
        return None


