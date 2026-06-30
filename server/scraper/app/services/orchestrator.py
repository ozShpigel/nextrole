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


async def run_discovery(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str, run_id: str | None = None):
    """Execute a full discovery run: scrape, score via JobMatchService, save."""
    criteria_doc = await db.search_criteria.find_one({"id": criteria_id})
    if not criteria_doc:
        logger.error("Criteria %s not found", criteria_id)
        return

    from app.models.search_criteria import SearchCriteria
    from app.models.discovery_run import DiscoveryRun

    criteria = SearchCriteria(**criteria_doc)
    if run_id:
        run_doc = await db.discovery_runs.find_one({"id": run_id})
        run = DiscoveryRun(**{k: v for k, v in run_doc.items() if k != "_id"}) if run_doc else DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name)
    else:
        run = DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name)
        await db.discovery_runs.insert_one(run.model_dump())
    run.status = "scraping"
    await db.discovery_runs.update_one({"id": run.id}, {"$set": {"status": "scraping"}})

    try:
        logger.info("Run %s: scraping for criteria '%s'", run.id, criteria.name)
        jobs = await asyncio.get_running_loop().run_in_executor(
            None, scraper.scrape_for_criteria, criteria
        )

        run.jobs_scraped = len(jobs)
        run.status = "scoring"
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}},
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

        concurrency = 5
        sem = asyncio.Semaphore(concurrency)
        logger.info("Run %s: scoring %d jobs (%d concurrent)", run.id, len(jobs), concurrency)

        async def _score_one(i: int, job_data: dict):
            async with sem:
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
                        return

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
                        if match_result.status == "rate_limited":
                            logger.warning("Rate-limited — pausing 60s")
                            await asyncio.sleep(60.0)
                        return

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

                    # Single, predictable rule: auto-save iff score meets the
                    # threshold. verdict/should_apply are display-only signals
                    # (verdict is just the score in bands, so adding it here only
                    # muddied the threshold). The slider is the source of truth.
                    qualifies = score is not None and score >= criteria.min_score_to_save
                    if qualifies:
                        analysis_json = json.dumps(match_response, ensure_ascii=False)
                        saved = await tracker_client.save_to_tracker(
                            settings=settings,
                            title=title,
                            company=company,
                            description=job_data.get("description"),
                            score=score,
                            verdict=verdict,
                            analysis_json=analysis_json,
                            job_url=job_data.get("job_url"),
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

                except Exception as e:
                    logger.error("Error processing job %d '%s': %s", i, job_data.get("title"), e)

        await asyncio.gather(*[_score_one(i, jd) for i, jd in enumerate(jobs)])

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}},
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
            {"id": run.id, "status": {"$ne": "cancelled"}},
            {"$set": {
                "status": "failed",
                "error": str(e),
                "completed_at": datetime.now(timezone.utc),
            }},
        )


async def run_discovery_batch(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str, run_id: str | None = None):
    """Batch discovery — phase 1 (submit).

    Scrape, enrich, and run the Analyst (Haiku) live per job, then submit ALL
    parsed jobs as one Evaluator (Sonnet) batch at 50% cost. Stores the batch id
    and parks the run in `awaiting_batch`; results are collected later by
    `finalize_batches`. Mirrors run_discovery's scrape/dedup/enrich, but defers
    the expensive evaluator to the batch.
    """
    criteria_doc = await db.search_criteria.find_one({"id": criteria_id})
    if not criteria_doc:
        logger.error("Criteria %s not found", criteria_id)
        return

    from app.models.search_criteria import SearchCriteria
    from app.models.discovery_run import DiscoveryRun

    criteria = SearchCriteria(**criteria_doc)
    if run_id:
        run_doc = await db.discovery_runs.find_one({"id": run_id})
        run = DiscoveryRun(**{k: v for k, v in run_doc.items() if k != "_id"}) if run_doc else DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name, mode="batch")
    else:
        run = DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name, mode="batch")
        await db.discovery_runs.insert_one(run.model_dump())
    await db.discovery_runs.update_one({"id": run.id}, {"$set": {"status": "scraping", "mode": "batch"}})

    try:
        logger.info("Run %s (batch): scraping for criteria '%s'", run.id, criteria.name)
        jobs = await asyncio.get_running_loop().run_in_executor(
            None, scraper.scrape_for_criteria, criteria
        )
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}}, {"$set": {"status": "parsing", "jobs_scraped": len(jobs)}})

        if not await tracker_client.warm_up_api(settings):
            raise RuntimeError("API unreachable after warm-up — aborting run")

        all_companies = [j["company"] for j in jobs if j.get("company")]
        news_cache, glassdoor_cache = await asyncio.gather(
            news_client.prefetch_company_news(all_companies),
            glassdoor_client.prefetch_glassdoor_ratings(all_companies),
        )

        sem = asyncio.Semaphore(5)
        items: list[dict] = []
        skipped_dup = 0

        async def _parse_one(job_data: dict):
            nonlocal skipped_dup
            async with sem:
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

                    if await tracker_client.check_duplicate(settings, company, title):
                        await db.discovered_jobs.insert_one(DiscoveredJob(**base_job, is_duplicate=True).model_dump())
                        skipped_dup += 1
                        return

                    desc = job_data.get("description")
                    if not desc or len(desc) < 50:
                        await db.discovered_jobs.insert_one(DiscoveredJob(**base_job, verdict="INSUFFICIENT_DATA").model_dump())
                        return

                    news = await news_client.fetch_company_news(company, news_cache) or None
                    glass = await glassdoor_client.fetch_glassdoor_rating(company, glassdoor_cache)

                    parsed_resp = await match_client.parse_job(settings, title, company, desc)
                    if parsed_resp is None or not parsed_resp.get("parsed"):
                        await db.discovered_jobs.insert_one(DiscoveredJob(**base_job, verdict="MATCH_FAILED").model_dump())
                        return

                    # Persist a stub (no score yet); the batch result fills it in.
                    disc = DiscoveredJob(
                        **base_job,
                        company_news=news,
                        glassdoor_data=glass,
                        analyst_snapshot_input=parsed_resp.get("analystSnapshotInput"),
                        analyst_snapshot_output=parsed_resp.get("analystSnapshotOutput"),
                    )
                    await db.discovered_jobs.insert_one(disc.model_dump())
                    # asyncio is single-threaded — append between awaits is safe.
                    items.append({
                        "customId": disc.id,
                        "parsedJob": parsed_resp["parsed"],
                        "companyNews": news,
                        "glassdoorData": glass,
                    })
                except Exception as e:
                    logger.error("Batch parse error for '%s': %s", job_data.get("title"), e)

        await asyncio.gather(*[_parse_one(jd) for jd in jobs])

        if not items:
            await db.discovery_runs.update_one({"id": run.id, "status": {"$ne": "cancelled"}}, {"$set": {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc),
                "jobs_skipped_duplicate": skipped_dup,
            }})
            logger.info("Run %s (batch): nothing to score", run.id)
            return

        batch_id = await match_client.submit_evaluation_batch(settings, items)
        if not batch_id:
            raise RuntimeError("Batch submit failed")

        await db.discovery_runs.update_one({"id": run.id, "status": {"$ne": "cancelled"}}, {"$set": {
            "status": "awaiting_batch",
            "batch_id": batch_id,
            "batch_submitted_at": datetime.now(timezone.utc),
            "jobs_skipped_duplicate": skipped_dup,
        }})
        logger.info("Run %s (batch): submitted %d jobs as batch %s", run.id, len(items), batch_id)

    except Exception as e:
        logger.error("Run %s (batch) failed: %s", run.id, e)
        await db.discovery_runs.update_one({"id": run.id, "status": {"$ne": "cancelled"}}, {"$set": {
            "status": "failed", "error": str(e), "completed_at": datetime.now(timezone.utc),
        }})


async def finalize_batches(db: AsyncIOMotorDatabase, settings: Settings):
    """Batch discovery — phase 2 (collect). For every run parked in
    `awaiting_batch`, poll its batch; once ended, fill in each job's score/verdict
    and auto-save qualifying jobs to the tracker. Safe to call repeatedly — runs
    whose batch isn't ready yet are left untouched for the next cycle.
    """
    runs = await db.discovery_runs.find({"status": "awaiting_batch"}).to_list(50)
    if not runs:
        return
    logger.info("finalize_batches: %d run(s) awaiting batch results", len(runs))

    for run_doc in runs:
        run_id = run_doc["id"]
        batch_id = run_doc.get("batch_id")
        if not batch_id:
            await db.discovery_runs.update_one({"id": run_id}, {"$set": {
                "status": "failed", "error": "awaiting_batch with no batch_id",
                "completed_at": datetime.now(timezone.utc)}})
            continue

        result = await match_client.get_evaluation_batch(settings, batch_id)
        if result is None:
            continue  # transient API error — retry next cycle
        if not result.get("ended"):
            logger.info("Run %s: batch %s still processing (%s)", run_id, batch_id, result.get("status"))
            continue

        await db.discovery_runs.update_one({"id": run_id}, {"$set": {"status": "finalizing"}})
        criteria_doc = await db.search_criteria.find_one({"id": run_doc["criteria_id"]})
        min_score = (criteria_doc or {}).get("min_score_to_save", 70)

        scored = saved = failed = 0
        for line in result.get("lines", []):
            job_id = line.get("customId")
            disc = await db.discovered_jobs.find_one({"id": job_id})
            if not disc:
                continue
            response = line.get("response")
            if not response:
                await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"verdict": "MATCH_FAILED"}})
                failed += 1
                continue

            score, verdict, should_apply = extract_flat(response)
            await db.discovered_jobs.update_one({"id": job_id}, {"$set": {
                "score": score, "verdict": verdict, "should_apply": should_apply,
                "match_analysis": response,
                "evaluator_snapshot_output": line.get("rawOutput"),
            }})
            scored += 1

            # Score-only threshold (see live path) — single source of truth.
            qualifies = score is not None and score >= min_score
            if qualifies:
                saved_ok = await tracker_client.save_to_tracker(
                    settings=settings,
                    title=disc["title"], company=disc["company"],
                    description=disc.get("description"),
                    score=score, verdict=verdict,
                    analysis_json=json.dumps(response, ensure_ascii=False),
                    job_url=disc.get("job_url"),
                    analyst_snapshot_input=disc.get("analyst_snapshot_input"),
                    analyst_snapshot_output=disc.get("analyst_snapshot_output"),
                    evaluator_snapshot_input=None,
                    evaluator_snapshot_output=line.get("rawOutput"),
                    company_news=disc.get("company_news"),
                    glassdoor_data=disc.get("glassdoor_data"),
                )
                if saved_ok:
                    await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"saved_to_tracker": True}})
                    saved += 1

        await db.discovery_runs.update_one({"id": run_id}, {"$set": {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc),
            "jobs_scored": scored, "jobs_saved": saved,
        }})
        logger.info("Run %s (batch) finalized: %d scored, %d saved, %d failed", run_id, scored, saved, failed)
