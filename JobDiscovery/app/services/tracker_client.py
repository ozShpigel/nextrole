import asyncio
import logging

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_TRANSIENT_STATUSES = {429, 502, 503, 504}
_MAX_RETRIES = 3


async def _request_with_retry(
    method: str,
    url: str,
    *,
    timeout: float,
    operation: str,
    **request_kwargs,
) -> httpx.Response | None:
    """Send an HTTP request, retrying on transient failures (429/502/503/504 + transport errors).

    Returns the final Response (whether success or non-transient error), or None if
    all retries were exhausted by transport exceptions.
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(_MAX_RETRIES + 1):
            try:
                resp = await client.request(method, url, **request_kwargs)
            except httpx.RequestError as e:
                if attempt >= _MAX_RETRIES:
                    logger.error(
                        "Tracker %s (%s %s) failed after %d retries: %s",
                        operation, method, url, _MAX_RETRIES, e,
                    )
                    return None
                delay = min(2 ** attempt, 8)
                logger.warning(
                    "Tracker %s (%s %s) transport error: %s — retry %d/%d in %ds",
                    operation, method, url, e, attempt + 1, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
                continue

            if resp.status_code in _TRANSIENT_STATUSES and attempt < _MAX_RETRIES:
                delay = min(2 ** attempt, 8)
                logger.warning(
                    "Tracker %s (%s %s) returned %d — retry %d/%d in %ds",
                    operation, method, url, resp.status_code,
                    attempt + 1, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
                continue

            return resp
    return None


async def check_duplicate(settings: Settings, company: str, job_title: str) -> bool:
    """Check if an application already exists in ApplicationTracker."""
    resp = await _request_with_retry(
        "GET",
        f"{settings.application_tracker_base_url}/api/applications/exists",
        timeout=10.0,
        operation="dedup check",
        params={"company": company, "jobTitle": job_title},
    )
    if resp is None:
        logger.warning("Dedup check failed for '%s' at '%s' (all retries exhausted)", job_title, company)
        return False
    if resp.status_code == 200:
        # ApplicationTracker returns a bare JSON boolean (Results.Ok(bool)),
        # not an { exists: bool } object.
        return bool(resp.json())
    logger.warning(
        "Dedup check for '%s' at '%s' returned %d: %s",
        job_title, company, resp.status_code, resp.text,
    )
    return False


async def save_to_tracker(
    settings: Settings,
    title: str,
    company: str,
    description: str | None,
    score: int | None,
    verdict: str | None,
    analysis_json: str | None,
) -> bool:
    """Save a discovered job to ApplicationTracker."""
    payload = {
        "jobTitle": title,
        "company": company,
        "status": "Analyzing",
        "jobDescription": description or "",
        "matchScore": score,
        "matchVerdict": verdict,
        "matchAnalysis": analysis_json,
        "source": "discovery",
    }

    resp = await _request_with_retry(
        "POST",
        f"{settings.application_tracker_base_url}/api/applications",
        timeout=15.0,
        operation="save",
        json=payload,
    )
    if resp is None:
        logger.error("Tracker save for '%s' failed (all retries exhausted)", title)
        return False
    if resp.status_code in (200, 201):
        logger.info("Saved '%s' at '%s' to tracker", title, company)
        return True
    logger.warning(
        "Tracker save failed for '%s': %d %s",
        title, resp.status_code, resp.text,
    )
    return False
