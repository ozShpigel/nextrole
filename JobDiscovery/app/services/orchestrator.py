import asyncio
import json
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import scraper, scorer, tracker_client

logger = logging.getLogger(__name__)


async def run_discovery(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str):
    """Execute a full discovery run: scrape, score, save."""
    criteria_doc = await db.search_criteria.find_one({"id": criteria_id})
    if not criteria_doc:
        logger.error("Criteria %s not found", criteria_id)
        return

    # Create run record
    from app.models.search_criteria import SearchCriteria
    from app.models.discovery_run import DiscoveryRun

    criteria = SearchCriteria(**criteria_doc)
    run = DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name, status="scraping")
    await db.discovery_runs.insert_one(run.model_dump())

    try:
        # Step 1: Scrape
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

        # Step 2: Score each job serially
        logger.info("Run %s: scoring %d jobs", run.id, len(jobs))
        for i, job_data in enumerate(jobs):
            try:
                title = job_data["title"]
                company = job_data["company"]

                # Dedup check against ApplicationTracker
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

                # Score with Claude
                result = await scorer.score_job(
                    settings=settings,
                    title=title,
                    company=company,
                    location=job_data.get("location"),
                    description=job_data.get("description"),
                    date_posted=job_data.get("date_posted"),
                    site=job_data.get("site", "linkedin"),
                    db=db,
                )

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
                    score=result["score"],
                    verdict=result["verdict"],
                    honest_assessment=result["honestAssessment"],
                    key_strengths=result["keyStrengths"],
                    key_concerns=result["keyConcerns"],
                    should_apply=result["shouldApply"],
                )
                await db.discovered_jobs.insert_one(disc_job.model_dump())
                run.jobs_scored += 1

                # Auto-save qualifying jobs to tracker
                if (
                    result["score"] is not None
                    and result["score"] >= criteria.min_score_to_save
                    and result["shouldApply"]
                ):
                    analysis_json = json.dumps(result, ensure_ascii=False)
                    saved = await tracker_client.save_to_tracker(
                        settings=settings,
                        title=title,
                        company=company,
                        description=job_data.get("description"),
                        score=result["score"],
                        verdict=result["verdict"],
                        analysis_json=analysis_json,
                    )
                    if saved:
                        disc_job.saved_to_tracker = True
                        await db.discovered_jobs.update_one(
                            {"id": disc_job.id},
                            {"$set": {"saved_to_tracker": True}},
                        )
                        run.jobs_saved += 1

                # Update run progress
                await db.discovery_runs.update_one(
                    {"id": run.id},
                    {"$set": {
                        "jobs_scored": run.jobs_scored,
                        "jobs_saved": run.jobs_saved,
                        "jobs_skipped_duplicate": run.jobs_skipped_duplicate,
                    }},
                )

                # Rate limit between Claude calls
                if i < len(jobs) - 1 and result["verdict"] != "INSUFFICIENT_DATA":
                    await asyncio.sleep(settings.scoring_delay_seconds)

            except Exception as e:
                logger.error("Error processing job %d '%s': %s", i, job_data.get("title"), e)

        # Step 3: Complete
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
