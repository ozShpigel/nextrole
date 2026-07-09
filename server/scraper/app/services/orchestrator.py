import asyncio
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import embeddings, match_client, scraper, tracker_client

logger = logging.getLogger(__name__)


async def run_discovery(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str, run_id: str | None = None):
    """Execute an ingest-only discovery run: scrape, triage, embed, store.

    Per-job Claude scoring was retired — matching now happens on demand via
    Atlas $vectorSearch + a single advisor call (see services/search.py).
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
        jobs = await asyncio.get_running_loop().run_in_executor(
            None, scraper.scrape_for_criteria, criteria
        )

        run.jobs_scraped = len(jobs)
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}},
            {"$set": {"status": "embedding", "jobs_scraped": len(jobs)}},
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

        # Embed all relevant jobs in batched OpenAI calls. A failed chunk
        # yields None entries — those jobs are stored without an embedding
        # and stay invisible to $vectorSearch.
        relevant = [(i, j) for i, j in enumerate(jobs) if _is_relevant(i)]
        texts = [embeddings.build_job_embedding_text(j) for _, j in relevant]
        logger.info("Run %s: embedding %d/%d jobs", run.id, len(relevant), len(jobs))
        vectors = await embeddings.embed_texts(settings, texts)
        vector_by_index = {i: v for (i, _), v in zip(relevant, vectors)}

        # Duplicate check is cheap and still useful as a flag (the job stays
        # searchable; the UI marks it as already tracked).
        dup_sem = asyncio.Semaphore(5)

        async def _ingest_one(i: int, job_data: dict):
            try:
                base_job = {
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
                    "is_remote": job_data.get("is_remote"),
                }

                if not _is_relevant(i):
                    disc_job = DiscoveredJob(
                        **base_job,
                        triaged_out=True,
                        triage_reason=(triage.get(i) or {}).get("reason"),
                    )
                    await db.discovered_jobs.insert_one(disc_job.model_dump())
                    run.jobs_triaged_out += 1
                    return

                async with dup_sem:
                    is_dup = await tracker_client.check_duplicate(
                        settings, job_data["company"], job_data["title"]
                    )
                if is_dup:
                    run.jobs_skipped_duplicate += 1

                vector = vector_by_index.get(i)
                disc_job = DiscoveredJob(
                    **base_job,
                    is_duplicate=is_dup,
                    job_embedding=vector,
                    embedding_model=embeddings.EMBEDDING_MODEL if vector else None,
                )
                await db.discovered_jobs.insert_one(disc_job.model_dump())
                if vector:
                    run.jobs_embedded += 1
                else:
                    run.jobs_embed_failed += 1
            except Exception as e:
                logger.error("Error ingesting job %d '%s': %s", i, job_data.get("title"), e)

        await asyncio.gather(*[_ingest_one(i, jd) for i, jd in enumerate(jobs)])

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        await db.discovery_runs.update_one(
            {"id": run.id, "status": {"$ne": "cancelled"}},
            {"$set": {
                "status": "completed",
                "completed_at": run.completed_at,
                "jobs_embedded": run.jobs_embedded,
                "jobs_embed_failed": run.jobs_embed_failed,
                "jobs_skipped_duplicate": run.jobs_skipped_duplicate,
                "jobs_triaged_out": run.jobs_triaged_out,
            }},
        )
        logger.info(
            "Run %s completed: %d scraped, %d embedded, %d embed-failed, %d duplicates, %d triaged out",
            run.id, run.jobs_scraped, run.jobs_embedded, run.jobs_embed_failed,
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
