import logging
from typing import Literal, NamedTuple

from app.config import Settings
from app.services.tracker_client import _request_with_retry

logger = logging.getLogger(__name__)


class MatchResult(NamedTuple):
    # "ok": data is the rich MatchResponse dict.
    # "too_short": description below the analyst floor — not worth burning
    #              tokens on; treat as terminal INSUFFICIENT_DATA.
    # "rate_limited": API returned 429. Caller should back off before retrying.
    # "api_error": the API call itself failed (timeout / non-429 non-200 /
    #              all retries exhausted). Retryable once the API is warm.
    status: Literal["ok", "too_short", "rate_limited", "api_error"]
    data: dict | None


async def score_job(
    settings: Settings,
    title: str,
    company: str,
    location: str | None,
    description: str | None,
    date_posted: str | None,
    site: str,
    company_news: list[dict] | None = None,
    glassdoor_data: dict | None = None,
) -> MatchResult:
    """Call the unified API to score a scraped job.

    Returns a MatchResult so the orchestrator can tell the difference between
    a job that's genuinely un-scorable (description too short) and one that
    failed transiently (API cold-start / rate-limit / timeout).
    """
    if not description or len(description) < 50:
        logger.info("Skipping '%s' at '%s' — description too short for analysis", title, company)
        return MatchResult("too_short", None)

    payload = {
        "jobDescription": description,
        "title": title,
        "company": company,
        "location": location,
        "datePosted": date_posted,
        "site": site,
        "companyNews": company_news,
        "glassdoorData": glassdoor_data,
    }

    # Budget covers a warm Render instance doing Analyst (Haiku) + Evaluator
    # (Sonnet with extended thinking budget up to ~5k tokens). Timeouts here
    # almost always mean the single call is too slow — retrying wedges the
    # orchestrator for another full window, so we skip it and move on. The
    # job gets written as MATCH_FAILED and the user can re-trigger later.
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match",
        timeout=300.0,
        operation="match",
        retry_on_timeout=False,
        json=payload,
    )
    if resp is None:
        logger.error("API match call failed for '%s' at '%s' (all retries exhausted)", title, company)
        return MatchResult("api_error", None)
    if resp.status_code == 200:
        return MatchResult("ok", resp.json())
    if resp.status_code == 429:
        logger.warning("Rate-limited by API for '%s' at '%s' — all retries exhausted", title, company)
        return MatchResult("rate_limited", None)
    logger.warning(
        "API match returned %d for '%s' at '%s': %s",
        resp.status_code, title, company, resp.text,
    )
    return MatchResult("api_error", None)


# ── Batch path (cron) ───────────────────────────────────────────────────────

async def parse_job(
    settings: Settings,
    title: str,
    company: str,
    description: str | None,
) -> dict | None:
    """Stage 1: analyst-only parse (live Haiku). Returns the API response
    {parsed, analystSnapshotInput, analystSnapshotOutput}, or None on failure."""
    if not description or len(description) < 50:
        return None
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/parse",
        timeout=120.0,
        operation="parse",
        retry_on_timeout=False,
        json={"jobDescription": description, "title": title, "company": company},
    )
    if resp is not None and resp.status_code == 200:
        return resp.json()
    logger.warning("Parse failed for '%s' at '%s' (%s)", title, company,
                   resp.status_code if resp is not None else "no response")
    return None


async def submit_evaluation_batch(settings: Settings, items: list[dict]) -> str | None:
    """Stage 2: submit all parsed jobs as one evaluator batch. Returns batch id."""
    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match/batch",
        timeout=60.0,
        operation="batch submit",
        json=items,
    )
    if resp is not None and resp.status_code == 200:
        return resp.json().get("batchId")
    logger.error("Batch submit failed (%s)", resp.status_code if resp is not None else "no response")
    return None


async def get_evaluation_batch(settings: Settings, batch_id: str) -> dict | None:
    """Stage 3: poll/collect. Returns {status, ended, lines:[...]}, or None on error."""
    resp = await _request_with_retry(
        "GET",
        f"{settings.api_base_url}/api/match/batch/{batch_id}",
        timeout=120.0,
        operation="batch get",
        retry_on_timeout=False,
    )
    if resp is not None and resp.status_code == 200:
        return resp.json()
    logger.warning("Batch get failed for %s (%s)", batch_id,
                   resp.status_code if resp is not None else "no response")
    return None
