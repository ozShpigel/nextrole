import asyncio
import json
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import glassdoor_client, match_client, news_client, scraper, tracker_client
from app.utils.match_utils import extract_flat

logger = logging.getLogger(__name__)


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
        jobs = await asyncio.get_running_loop().run_in_executor(
            None, scraper.scrape_for_criteria, criteria
        )

        run.jobs_scraped = len(jobs)
        run.status = "scoring"
        await db.discovery_runs.update_one(
            {"id": run.id},
            {"$set": {"status": "scoring", "jobs_scraped": len(jobs)}},
        )

        # Wake the API before the scoring loop. On Render free tier the
        # per-call retry budget (~15s) is too small to cover a 30-60s cold
        # start, so we'd burn it on the first few jobs and lose them.
        logger.info("Run %s: warming up API before scoring", run.id)
        if not await tracker_client.warm_up_api(settings):
            raise RuntimeError("API unreachable after warm-up — aborting run")

        # Prefetch company news and Glassdoor ratings in parallel for all unique companies.
        all_companies = [j["company"] for j in jobs if j.get("company")]
        news_cache, glassdoor_cache = await asyncio.gather(
            news_client.prefetch_company_news(all_companies),
            glassdoor_client.prefetch_glassdoor_ratings(all_companies),
        )

        logger.info("Run %s: scoring %d jobs", run.id, len(jobs))
        for i, job_data in enumerate(jobs):
            try:
                title = job_data["title"]
                company = job_data["company"]
                base_job = {
                    "run_id": run.id,
                    "criteria_id": criteria.id,
                    "title": title,
                    "company": company,
                    "location": job_data.get("location"),
                    "description": job_data.get("description"),
                    "job_url": job_data.get("job_url"),
                    "date_posted": job_data.get("date_posted"),
                    "site": job_data.get("site", "linkedin"),
                }

                is_dup = await tracker_client.check_duplicate(settings, company, title)
                if is_dup:
                    disc_job = DiscoveredJob(**base_job, is_duplicate=True)
                    await db.discovered_jobs.insert_one(disc_job.model_dump())
                    run.jobs_skipped_duplicate += 1
                    continue

                company_news = await news_client.fetch_company_news(company, news_cache) or None
                glassdoor_data = await glassdoor_client.fetch_glassdoor_rating(company, glassdoor_cache)

                match_result = await match_client.score_job(
                    settings=settings,
                    title=title,
                    company=company,
                    location=job_data.get("location"),
                    description=job_data.get("description"),
                    date_posted=job_data.get("date_posted"),
                    site=job_data.get("site", "linkedin"),
                    company_news=company_news,
                    glassdoor_data=glassdoor_data,
                )

                if match_result.status != "ok":
                    verdict = "INSUFFICIENT_DATA" if match_result.status == "too_short" else "MATCH_FAILED"
                    disc_job = DiscoveredJob(**base_job, verdict=verdict)
                    await db.discovered_jobs.insert_one(disc_job.model_dump())
                    if i < len(jobs) - 1:
                        if match_result.status == "rate_limited":
                            logger.warning("Rate-limited — pausing 60s before next job to let the window reset")
                            await asyncio.sleep(60.0)
                        elif match_result.status == "api_error":
                            await asyncio.sleep(settings.scoring_delay_seconds)
                    continue

                match_response = match_result.data
                score, verdict, should_apply = extract_flat(match_response)

                disc_job = DiscoveredJob(
                    **base_job,
                    score=score,
                    verdict=verdict,
                    should_apply=should_apply,
                    match_analysis=match_response,
                    company_news=company_news,
                    glassdoor_data=glassdoor_data,
                    analyst_snapshot_input=match_response.get("analystSnapshotInput"),
                    analyst_snapshot_output=match_response.get("analystSnapshotOutput"),
                    evaluator_snapshot_input=match_response.get("evaluatorSnapshotInput"),
                    evaluator_snapshot_output=match_response.get("evaluatorSnapshotOutput"),
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
                        analyst_snapshot_input=disc_job.analyst_snapshot_input,
                        analyst_snapshot_output=disc_job.analyst_snapshot_output,
                        evaluator_snapshot_input=disc_job.evaluator_snapshot_input,
                        evaluator_snapshot_output=disc_job.evaluator_snapshot_output,
                        company_news=company_news,
                        glassdoor_data=glassdoor_data,
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
