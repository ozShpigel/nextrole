import logging

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


async def check_duplicate(settings: Settings, company: str, job_title: str) -> bool:
    """Check if an application already exists in ApplicationTracker."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.application_tracker_base_url}/api/applications/exists",
                params={"company": company, "jobTitle": job_title},
            )
            if resp.status_code == 200:
                return resp.json().get("exists", False)
    except Exception as e:
        logger.warning("Dedup check failed for '%s' at '%s': %s", job_title, company, e)
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

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.application_tracker_base_url}/api/applications",
                json=payload,
            )
            if resp.status_code in (200, 201):
                logger.info("Saved '%s' at '%s' to tracker", title, company)
                return True
            else:
                logger.warning(
                    "Tracker save failed for '%s': %d %s",
                    title, resp.status_code, resp.text,
                )
    except Exception as e:
        logger.error("Tracker save error for '%s': %s", title, e)
    return False
