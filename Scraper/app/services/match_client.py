import logging

from app.config import Settings
from app.services.tracker_client import _request_with_retry

logger = logging.getLogger(__name__)


async def score_job(
    settings: Settings,
    title: str,
    company: str,
    location: str | None,
    description: str | None,
    date_posted: str | None,
    site: str,
) -> dict | None:
    """Call the unified API to score a scraped job.

    Returns the raw rich MatchResponse dict, or None on failure / insufficient data.
    """
    if not description or len(description) < 50:
        logger.info("Skipping '%s' at '%s' — description too short for analysis", title, company)
        return None

    payload = {
        "jobDescription": description,
        "title": title,
        "company": company,
        "location": location,
        "datePosted": date_posted,
        "site": site,
    }

    resp = await _request_with_retry(
        "POST",
        f"{settings.api_base_url}/api/match",
        timeout=120.0,
        operation="match",
        json=payload,
    )
    if resp is None:
        logger.error("API match call failed for '%s' at '%s' (all retries exhausted)", title, company)
        return None
    if resp.status_code == 200:
        return resp.json()
    logger.warning(
        "API match returned %d for '%s' at '%s': %s",
        resp.status_code, title, company, resp.text,
    )
    return None
