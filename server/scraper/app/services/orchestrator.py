import asyncio
import logging
from datetime import datetime, timezone
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import glassdoor_client, match_client, news_client, scraper, tracker_client

logger = logging.getLogger(__name__)

# Batched-scoring cost design: N jobs per Evaluator call (well under the API's
# hard cap of 5) share one system-prompt/profile input cost instead of N —
# the whole point of batching over one-call-per-job. Concurrent in-flight
# batches are capped separately (not just relying on the API's own rate
# limiter) so a big run doesn't fire dozens of calls at once — a starting,
# unmeasured estimate; tune against a real run before trusting a daily cron.
SCORE_BATCH_SIZE = 4
MAX_CONCURRENT_SCORE_BATCHES = 2


async def run_discovery(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str, run_id: str | None = None):
    """Execute a discovery run: scrape, triage, classify seniority, store.

    RAG/vector-search matching was removed — per-job Evaluator scoring is the
    primary matching path again (added as a batched-scoring step below).
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
        run = DiscoveryRun(**{k: v for k, v in run_doc.items() if k != "_id"}) if run_doc else DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name)
    else:
        run = DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name)
        await db.discovery_runs.insert_one(run.model_dump())
    run.status = "scraping"
    await db.discovery_runs.update_one({"id": run.id}, {"$set": {"status": "scraping"}})

    try:
        logger.info("Run %s: scraping for criteria '%s'", run.id, criteria.name)
        jobs, search_stats = await asyncio.get_running_loop().run_in_executor(
            None, scraper.scrape_for_criteria, criteria
        )

        run.jobs_scraped = len(jobs)
        run.searches_total = search_stats["searches_total"]
        run.searches_failed = search_stats["searches_failed"]
        run.searches_empty = search_stats["searches_empty"]
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}},
            {"$set": {
                "status": "scoring",
                "jobs_scraped": len(jobs),
                "searches_total": run.searches_total,
                "searches_failed": run.searches_failed,
                "searches_empty": run.searches_empty,
            }},
        )

        # Wake the API before triage/duplicate checks. On Render free tier the
        # per-call retry budget (~15s) is too small to cover a 30-60s cold start.
        if not await tracker_client.warm_up_api(settings):
            raise RuntimeError("API unreachable after warm-up — aborting run")

        # Title triage: one Haiku call flags clearly off-target titles
        # (job-board search padding) so they skip embedding. Fails open —
        # on any error every job is kept.
        triage = await match_client.triage_titles(
            settings, ", ".join(criteria.job_titles), jobs
        ) or {}

        def _is_relevant(idx: int) -> bool:
            t = triage.get(idx)
            return t is None or t["relevant"]

        # Seniority classification: one Haiku call flags each relevant job's
        # actual seniority band (source-agnostic — replaces jobspy's
        # LinkedIn-only job_level as the client-side filter). Only classify
        # jobs that survived triage; fails open (None everywhere) on error.
        relevant_jobs = [j for i, j in enumerate(jobs) if _is_relevant(i)]
        seniority = await match_client.classify_seniority(settings, relevant_jobs) or {}
        # classify_seniority is indexed against relevant_jobs, not the
        # original jobs list (triaged-out jobs were never sent) — remap back
        # to the original indices used everywhere else below.
        relevant_original_indices = [i for i, j in enumerate(jobs) if _is_relevant(i)]
        seniority_by_original_index = {
            relevant_original_indices[i]: level for i, level in seniority.items()
        }

        # Duplicate check is cheap and still useful as a flag (the job stays
        # searchable; the UI marks it as already tracked).
        dup_sem = asyncio.Semaphore(5)

        def _base_job(i: int, job_data: dict) -> dict:
            return {
                "run_id": run.id,
                "criteria_id": criteria.id,
                "title": job_data["title"],
                "company": job_data["company"],
                "location": job_data.get("location"),
                "description": job_data.get("description"),
                "job_url": job_data.get("job_url"),
                "date_posted": job_data.get("date_posted"),
                "site": job_data.get("site", "linkedin"),
                "job_level": job_data.get("job_level"),
                "actual_job_level": seniority_by_original_index.get(i),
                "is_remote": job_data.get("is_remote"),
                "company_logo": job_data.get("company_logo"),
                "company_profile": job_data.get("company_profile"),
            }

        async def _insert_triaged_out(i: int, job_data: dict):
            try:
                disc_job = DiscoveredJob(
                    **_base_job(i, job_data),
                    triaged_out=True,
                    triage_reason=(triage.get(i) or {}).get("reason"),
                )
                await db.discovered_jobs.insert_one(disc_job.model_dump())
                run.jobs_triaged_out += 1
            except Exception as e:
                logger.error("Error ingesting triaged-out job %d '%s': %s", i, job_data.get("title"), e)

        relevant_indices = [i for i in range(len(jobs)) if _is_relevant(i)]

        # Enrichment prefetch: unique companies across every relevant job,
        # deduped once up front — same prefetch-then-cache pattern the old RAG
        # search path used per-search, just applied to the whole run's
        # relevant set instead of a top-N slice.
        relevant_companies = [jobs[i]["company"] for i in relevant_indices if jobs[i].get("company")]
        news_cache, glassdoor_cache = await asyncio.gather(
            news_client.prefetch_company_news(relevant_companies),
            glassdoor_client.prefetch_glassdoor_ratings(relevant_companies),
        )

        # Job ids are generated up front (not left to DiscoveredJob's default
        # factory) so the batch-score response can be correlated back to the
        # right document before it's ever constructed.
        relevant_with_ids = [(i, jobs[i], str(uuid4())) for i in relevant_indices]
        batch_sem = asyncio.Semaphore(MAX_CONCURRENT_SCORE_BATCHES)

        async def _score_and_insert_batch(chunk: list[tuple[int, dict, str]]):
            items = []
            for i, job_data, job_id in chunk:
                key = (job_data.get("company") or "").strip().lower()
                items.append({
                    "id": job_id,
                    "jobDescription": job_data.get("description") or "",
                    "title": job_data.get("title"),
                    "company": job_data.get("company"),
                    "location": job_data.get("location"),
                    "datePosted": job_data.get("date_posted"),
                    "site": job_data.get("site"),
                    "companyNews": news_cache.get(key) or None,
                    "glassdoorData": glassdoor_cache.get(key),
                    "companyProfile": job_data.get("company_profile"),
                })

            async with batch_sem:
                scores = await match_client.score_job_batch(settings, items)

            for i, job_data, job_id in chunk:
                try:
                    key = (job_data.get("company") or "").strip().lower()
                    async with dup_sem:
                        is_dup = await tracker_client.check_duplicate(
                            settings, job_data["company"], job_data["title"]
                        )
                    if is_dup:
                        run.jobs_skipped_duplicate += 1

                    match_response = (scores or {}).get(job_id)
                    if match_response is None:
                        run.jobs_score_failed += 1
                        disc_job = DiscoveredJob(id=job_id, **_base_job(i, job_data), is_duplicate=is_dup)
                    else:
                        run.jobs_scored += 1
                        recommendation = match_response.get("recommendation") or {}
                        # Snapshots live in their own DiscoveredJob fields — strip
                        # them out of match_analysis to avoid storing them twice
                        # (mirrors the manual Score-a-Job page's Save-to-Tracker
                        # convention).
                        analysis = {
                            k: v for k, v in match_response.items()
                            if k not in ("analystSnapshotInput", "analystSnapshotOutput",
                                        "evaluatorSnapshotInput", "evaluatorSnapshotOutput")
                        }
                        disc_job = DiscoveredJob(
                            id=job_id,
                            **_base_job(i, job_data),
                            is_duplicate=is_dup,
                            score=match_response.get("overallScore"),
                            verdict=match_response.get("verdict"),
                            should_apply=recommendation.get("shouldApply"),
                            match_analysis=analysis,
                            analyst_snapshot_input=match_response.get("analystSnapshotInput"),
                            analyst_snapshot_output=match_response.get("analystSnapshotOutput"),
                            evaluator_snapshot_input=match_response.get("evaluatorSnapshotInput"),
                            evaluator_snapshot_output=match_response.get("evaluatorSnapshotOutput"),
                            company_news=news_cache.get(key) or None,
                            glassdoor_data=glassdoor_cache.get(key),
                        )
                    await db.discovered_jobs.insert_one(disc_job.model_dump())
                except Exception as e:
                    logger.error("Error ingesting scored job %d '%s': %s", i, job_data.get("title"), e)

        chunks = [
            relevant_with_ids[i:i + SCORE_BATCH_SIZE]
            for i in range(0, len(relevant_with_ids), SCORE_BATCH_SIZE)
        ]
        triaged_out_indices = [i for i in range(len(jobs)) if not _is_relevant(i)]
        await asyncio.gather(
            *[_insert_triaged_out(i, jobs[i]) for i in triaged_out_indices],
            *[_score_and_insert_batch(chunk) for chunk in chunks],
        )

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}},
            {"$set": {
                "status": "completed",
                "completed_at": run.completed_at,
                "jobs_scored": run.jobs_scored,
                "jobs_score_failed": run.jobs_score_failed,
                "jobs_skipped_duplicate": run.jobs_skipped_duplicate,
                "jobs_triaged_out": run.jobs_triaged_out,
            }},
        )
        logger.info(
            "Run %s completed: %d scraped, %d scored, %d score-failed, %d duplicates, %d triaged out",
            run.id, run.jobs_scraped, run.jobs_scored, run.jobs_score_failed,
            run.jobs_skipped_duplicate, run.jobs_triaged_out,
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
