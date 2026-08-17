import asyncio
import json
import logging

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_TRANSIENT_STATUSES = {429, 502, 503, 504}
_MAX_RETRIES = 3


def _retry_after_seconds(resp: httpx.Response, floor: float, ceiling: float = 60.0) -> float:
    """Parse Retry-After (seconds or HTTP-date). Clamp to [floor, ceiling].

    Cloudflare on a 429 usually sends an integer seconds value. If the header
    is missing or unparseable, fall back to the caller's floor.
    """
    header = resp.headers.get("Retry-After")
    if not header:
        return floor
    try:
        return max(floor, min(ceiling, float(header.strip())))
    except ValueError:
        return floor


async def _request_with_retry(
    method: str,
    url: str,
    *,
    settings: Settings,
    timeout: float,
    operation: str,
    retry_on_timeout: bool = True,
    **request_kwargs,
) -> httpx.Response | None:
    """Send an HTTP request, retrying on transient failures (429/502/503/504 + transport errors).

    Returns the final Response (whether success or non-transient error), or None if
    all retries were exhausted by transport exceptions.

    Set `retry_on_timeout=False` for long LLM-backed calls where a timeout almost
    certainly means the downstream op is too slow — retrying just wedges the caller
    for another full timeout window each attempt.
    """
    headers = request_kwargs.pop("headers", None) or {}
    if settings.api_key:
        headers["X-Api-Key"] = settings.api_key
    # Lets the API bill the scraper's Claude calls (ingest scoring) on their own
    # Anthropic API key, separate from mailbot — no-op on the non-Claude calls
    # this function also makes.
    headers["X-Source"] = "ingest"
    request_kwargs["headers"] = headers
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(_MAX_RETRIES + 1):
            try:
                resp = await client.request(method, url, **request_kwargs)
            except httpx.TimeoutException as e:
                if not retry_on_timeout or attempt >= _MAX_RETRIES:
                    logger.error(
                        "Tracker %s (%s %s) timed out after %.0fs%s",
                        operation, method, url, timeout,
                        "" if retry_on_timeout else " (retry disabled for this op)",
                    )
                    return None
                delay = min(2 ** attempt, 8)
                logger.warning(
                    "Tracker %s (%s %s) timed out: %s — retry %d/%d in %ds",
                    operation, method, url, e, attempt + 1, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
                continue
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
                base_delay = min(2 ** attempt, 8)
                # On 429, Cloudflare usually dictates exactly how long to back
                # off — respect that instead of our exponential guess so we
                # don't keep feeding the same throttle bucket.
                delay = _retry_after_seconds(resp, floor=base_delay) if resp.status_code == 429 else base_delay
                logger.warning(
                    "Tracker %s (%s %s) returned %d — retry %d/%d in %.1fs",
                    operation, method, url, resp.status_code,
                    attempt + 1, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
                continue

            return resp
    return None


async def check_api_reachable(settings: Settings) -> bool:
    """Fail-fast reachability check before a run starts expensive work
    (triage/scoring) — better to abort clearly here than have some call deep
    into the run be the first thing to notice the API is down. Formerly a
    slow, wide "warm-up" loop for Render free-tier cold starts (a container
    that could take 30-60s to boot); the API now runs continuously on a VPS,
    so this just reuses the standard transient-retry logic like any other
    tracker call — no cold-start-specific handling needed.
    """
    resp = await _request_with_retry(
        "GET", f"{settings.api_base_url}/health",
        settings=settings, timeout=10.0, operation="health check",
    )
    return resp is not None and resp.status_code == 200


async def check_duplicate(settings: Settings, company: str, job_title: str) -> bool:
    """Check if an application already exists in the tracker."""
    resp = await _request_with_retry(
        "GET",
        f"{settings.api_base_url}/api/applications/exists",
        settings=settings,
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
    job_url: str | None = None,
    analyst_snapshot_input: str | None = None,
    analyst_snapshot_output: str | None = None,
    evaluator_snapshot_input: str | None = None,
    evaluator_snapshot_output: str | None = None,
    company_news: list[dict] | None = None,
    glassdoor_data: dict | None = None,
    company_logo: str | None = None,
) -> str | None:
    """Save a discovered job to the tracker. Returns the created/revived
    Application's id on success, None on failure."""
    payload = {
        "jobTitle": title,
        "company": company,
        "status": "DecidedToApply",
        "jobDescription": description or "",
        "jobUrl": job_url,
        "companyLogo": company_logo,
        "matchScore": score,
        "matchVerdict": verdict,
        "matchAnalysis": analysis_json,
        "analystSnapshotInput": analyst_snapshot_input,
        "analystSnapshotOutput": analyst_snapshot_output,
        "evaluatorSnapshotInput": evaluator_snapshot_input,
        "evaluatorSnapshotOutput": evaluator_snapshot_output,
        "companyNews": json.dumps(company_news, ensure_ascii=False) if company_news else None,
        "glassdoorData": json.dumps(glassdoor_data, ensure_ascii=False) if glassdoor_data else None,
        "source": "discovery",
    }

    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/applications",
        settings=settings,
        timeout=15.0,
        operation="save",
        json=payload,
    )
    if resp is None:
        logger.error("Tracker save for '%s' failed (all retries exhausted)", title)
        return None
    if resp.status_code in (200, 201):
        logger.info("Saved '%s' at '%s' to tracker", title, company)
        try:
            return resp.json().get("id")
        except Exception:
            return None
    logger.warning(
        "Tracker save failed for '%s': %d %s",
        title, resp.status_code, resp.text,
    )
    return None


async def update_match_analysis(settings: Settings, app_id: str, analysis_json: str) -> bool:
    """Patch an already-saved Application's match analysis — used by
    save_job()'s background enrichment task once the on-demand full-narrative
    call finishes, well after the Add click that created the application
    already returned. Best-effort: caller must not treat failure as fatal,
    the application already exists with whatever content it was saved with."""
    resp = await _request_with_retry(
        "PUT",
        f"{settings.api_base_url}/api/applications/{app_id}/match-analysis",
        settings=settings,
        timeout=10.0,
        operation="update-match-analysis",
        json={"matchAnalysis": analysis_json},
    )
    if resp is None or resp.status_code != 200:
        logger.warning("Match analysis update for application %s failed (%s)",
                       app_id, resp.status_code if resp is not None else "no response")
        return False
    return True
