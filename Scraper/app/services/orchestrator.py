import asyncio
import json
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import match_client, scraper, tracker_client

logger = logging.getLogger(__name__)


def _extract_flat(match_analysis: dict) -> tuple[int | None, str | None, bool | None]:
    """Pull sort/filter fields out of the rich MatchResponse."""
    score = match_analysis.get("overallScore")
    verdict = match_analysis.get("verdict")
    recommendation = match_analysis.get("recommendation") or {}
    should_apply = recommendation.get("shouldApply")
    return score, verdict, should_apply


async def run_discovery(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str):
    """Execute a full discovery run: scrape, score via JobMatchService, save."""
    criteria_doc = await db.search_criteria.find_one({"id": criteria_id})
    if not criteria_doc:
        logger.error("Criteria %s not found", criteria_id)
        return

    from app.models.search_criteria import SearchCriteria
    from app.models.discovery_run import DiscoveryRun

    criteria = SearchCriteria(**criteria_doc)
    run = DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name, status="scraping")
    await db.discovery_runs.insert_one(run.model_dump())

    try:
        logger.info("Run %s: scraping for criteria '%s'", run.id, criteria.name)
        jobs = await asyncio.get_event_loop().run_in_executor(
            None, scraper.scrape_for_criteria, criteria
        )

        run.jobs_scraped = len(jobs)
        run.status = "scoring"
        await db.discovery_runs.update_one(
            {"id": run.id},
            {"$set": {"status": "scoring", "jobs_scraped": len(jobs)}},
        )

        logger.info("Run %s: scoring %d jobs", run.id, len(jobs))
        for i, job_data in enumerate(jobs):
            try:
                title = job_data["title"]
                company = job_data["company"]

                is_dup = await tracker_client.check_duplicate(settings, company, title)
                if is_dup:
                    disc_job = DiscoveredJob(
                        run_id=run.id,
                        criteria_id=criteria.id,
                        title=title,
                        company=company,
                        location=job_data.get("location"),
                        description=job_data.get("description"),
                        job_url=job_data.get("job_url"),
                        date_posted=job_data.get("date_posted"),
                        site=job_data.get("site", "linkedin"),
                        is_duplicate=True,
                    )
                    await db.discovered_jobs.insert_one(disc_job.model_dump())
                    run.jobs_skipped_duplicate += 1
                    continue

                match_response = await match_client.score_job(
                    settings=settings,
                    title=title,
                    company=company,
                    location=job_data.get("location"),
                    description=job_data.get("description"),
                    date_posted=job_data.get("date_posted"),
                    site=job_data.get("site", "linkedin"),
                )

                if match_response is None:
                    disc_job = DiscoveredJob(
                        run_id=run.id,
                        criteria_id=criteria.id,
                        title=title,
                        company=company,
                        location=job_data.get("location"),
                        description=job_data.get("description"),
                        job_url=job_data.get("job_url"),
                        date_posted=job_data.get("date_posted"),
                        site=job_data.get("site", "linkedin"),
                        verdict="INSUFFICIENT_DATA",
                    )
                    await db.discovered_jobs.insert_one(disc_job.model_dump())
                    continue

                score, verdict, should_apply = _extract_flat(match_response)

                disc_job = DiscoveredJob(
                    run_id=run.id,
                    criteria_id=criteria.id,
                    title=title,
                    company=company,
                    location=job_data.get("location"),
                    description=job_data.get("description"),
                    job_url=job_data.get("job_url"),
                    date_posted=job_data.get("date_posted"),
                    site=job_data.get("site", "linkedin"),
                    score=score,
                    verdict=verdict,
                    should_apply=should_apply,
                    match_analysis=match_response,
                )
                await db.discovered_jobs.insert_one(disc_job.model_dump())
                run.jobs_scored += 1

                if (
                    score is not None
                    and score >= criteria.min_score_to_save
                    and bool(should_apply)
                ):
                    analysis_json = json.dumps(match_response, ensure_ascii=False)
                    saved = await tracker_client.save_to_tracker(
                        settings=settings,
                        title=title,
                        company=company,
                        description=job_data.get("description"),
                        score=score,
                        verdict=verdict,
                        analysis_json=analysis_json,
                    )
                    if saved:
                        disc_job.saved_to_tracker = True
                        await db.discovered_jobs.update_one(
                            {"id": disc_job.id},
                            {"$set": {"saved_to_tracker": True}},
                        )
                        run.jobs_saved += 1

                await db.discovery_runs.update_one(
                    {"id": run.id},
                    {"$set": {
                        "jobs_scored": run.jobs_scored,
                        "jobs_saved": run.jobs_saved,
                        "jobs_skipped_duplicate": run.jobs_skipped_duplicate,
                    }},
                )

                if i < len(jobs) - 1 and verdict != "INSUFFICIENT_DATA":
                    await asyncio.sleep(settings.scoring_delay_seconds)

            except Exception as e:
                logger.error("Error processing job %d '%s': %s", i, job_data.get("title"), e)

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        await db.discovery_runs.update_one(
            {"id": run.id},
            {"$set": {
                "status": "completed",
                "completed_at": run.completed_at,
                "jobs_scored": run.jobs_scored,
                "jobs_saved": run.jobs_saved,
                "jobs_skipped_duplicate": run.jobs_skipped_duplicate,
            }},
        )
        logger.info(
            "Run %s completed: %d scraped, %d scored, %d saved, %d duplicates",
            run.id, run.jobs_scraped, run.jobs_scored, run.jobs_saved, run.jobs_skipped_duplicate,
        )

    except Exception as e:
        logger.error("Run %s failed: %s", run.id, e)
        await db.discovery_runs.update_one(
            {"id": run.id},
            {"$set": {
                "status": "failed",
                "error": str(e),
                "completed_at": datetime.now(timezone.utc),
            }},
        )
