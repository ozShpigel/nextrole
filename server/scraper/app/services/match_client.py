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


async def advise(settings: Settings, jobs: list[dict]) -> dict | None:
    """One Sonnet call over the top-N vector-search hits: the API loads the
    profile server-side and returns a ranked advisor brief
    {overallRecommendation, rankings:[{jobId, rank, verdict, rationale, ...}]}.

    Returns None on any failure — the search endpoint surfaces that as 502.
    """
    if not jobs:
        return None
    # Budget covers a warm Render instance doing one Sonnet call over ~10
    # postings. Timeouts mean the single call is too slow — retrying would
    # double the wait, so surface the failure instead.
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/advise",
        settings=settings,
        timeout=300.0,
        operation="advise",
        retry_on_timeout=False,
        json={"jobs": jobs},
    )
    if resp is not None and resp.status_code == 200:
        return resp.json()
    logger.error("Advise call failed (%s)",
                 resp.status_code if resp is not None else "no response")
    return None
