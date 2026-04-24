import asyncio
import logging

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_TRANSIENT_STATUSES = {429, 502, 503, 504}
_MAX_RETRIES = 3

# Slow-and-wide warm-up cadence for Render free-tier cold starts.
# Render's edge (Cloudflare) bounces requests with 502 while the container
# is still booting and rate-limits fast retries with 429. ~20s spacing
# stays under the rate-limit threshold and gives Render enough quiet time
# to finish a 30-60s cold start between attempts. Mirrors the frontend's
# Scraper wake-up probe.
_WARMUP_MAX_ATTEMPTS = 5
_WARMUP_DELAY_SECONDS = 20.0
_WARMUP_TIMEOUT = 10.0


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


async def warm_up_api(settings: Settings) -> bool:
    """Probe the API's /health with slow, wide retries to wake a cold Render instance.

    The per-call retry helper (`_request_with_retry`) only budgets ~15s total,
    which isn't enough to cover a 30-60s Render cold start. This runs once at
    the top of a discovery run so the scoring loop starts against a warm API.
    Returns True on 200, False if the service is still unresponsive after the budget.
    """
    url = f"{settings.api_base_url}/health"
    async with httpx.AsyncClient(timeout=_WARMUP_TIMEOUT) as client:
        for attempt in range(1, _WARMUP_MAX_ATTEMPTS + 1):
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    if attempt > 1:
                        logger.info("API warm-up succeeded on attempt %d", attempt)
                    return True
                # 429 from Cloudflare's edge tells us the edge is reachable
                # but throttling us — it says nothing about whether the
                # container is warm. Continuing to probe just feeds the same
                # rate-limit bucket, so bail out and let the per-call retry
                # loop (which honors Retry-After) handle whatever comes next.
                if resp.status_code == 429:
                    logger.warning(
                        "API warm-up %s got 429 on attempt %d — edge is throttling, "
                        "skipping further probes and letting scoring loop proceed",
                        url, attempt,
                    )
                    return True
                logger.warning(
                    "API warm-up %s returned %d on attempt %d/%d",
                    url, resp.status_code, attempt, _WARMUP_MAX_ATTEMPTS,
                )
            except httpx.RequestError as e:
                logger.warning(
                    "API warm-up %s transport error on attempt %d/%d: %s",
                    url, attempt, _WARMUP_MAX_ATTEMPTS, e,
                )
            if attempt < _WARMUP_MAX_ATTEMPTS:
                await asyncio.sleep(_WARMUP_DELAY_SECONDS)
    logger.error(
        "API warm-up failed after %d attempts — service still not responding",
        _WARMUP_MAX_ATTEMPTS,
    )
    return False


async def check_duplicate(settings: Settings, company: str, job_title: str) -> bool:
    """Check if an application already exists in the tracker."""
    resp = await _request_with_retry(
        "GET",
        f"{settings.api_base_url}/api/applications/exists",
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
    analyst_snapshot_input: str | None = None,
    analyst_snapshot_output: str | None = None,
    evaluator_snapshot_input: str | None = None,
    evaluator_snapshot_output: str | None = None,
) -> bool:
    """Save a discovered job to the tracker."""
    payload = {
        "jobTitle": title,
        "company": company,
        "status": "Analyzing",
        "jobDescription": description or "",
        "matchScore": score,
        "matchVerdict": verdict,
        "matchAnalysis": analysis_json,
        "analystSnapshotInput": analyst_snapshot_input,
        "analystSnapshotOutput": analyst_snapshot_output,
        "evaluatorSnapshotInput": evaluator_snapshot_input,
        "evaluatorSnapshotOutput": evaluator_snapshot_output,
        "source": "discovery",
    }

    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/applications",
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
