import asyncio
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import company_size_client, glassdoor_client, match_client, news_client, scraper, tracker_client

logger = logging.getLogger(__name__)

# Batched-scoring cost design: N jobs per Evaluator call (well under the API's
# hard cap of 5) share one system-prompt/profile input cost instead of N —
# the whole point of batching over one-call-per-job. Concurrent in-flight
# batches are capped separately (not just relying on the API's own rate
# limiter) so a big run doesn't fire dozens of calls at once — a starting,
# unmeasured estimate; tune against a real run before trusting a daily cron.
SCORE_BATCH_SIZE = 4
MAX_CONCURRENT_SCORE_BATCHES = 2


def _parse_date_posted(value: str | None):
    """Best-effort YYYY-MM-DD parse for comparing two date_posted strings.
    Returns None on anything unparseable rather than raising — a comparison
    that can't be made safely should be skipped, not guessed at."""
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _backfill_date_posted(new_date_posted: str | None, existing_date_posted: str | None) -> str | None:
    """Decide whether a re-scraped job's date_posted should refresh the
    already-stored value. Returns the value to write, or None to leave the
    stored record untouched.

    Must only ever move forward in time. A re-scrape that came back with no
    date at all (jobspy's LinkedIn date_posted extraction is intermittently
    unreliable) must never blow away a good stored date — that's the whole
    point of this function existing instead of a bare overwrite.
    """
    new_date = _parse_date_posted(new_date_posted)
    if new_date is None:
        return None
    existing_date = _parse_date_posted(existing_date_posted)
    if existing_date is not None and new_date <= existing_date:
        return None
    return new_date_posted


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
        for job in jobs:
            logger.info("Job scraped: runId=%s jobId=%s company=%s title=%s",
                        run.id, job.get("id"), job.get("company"), job.get("title"))

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

        # Skip jobs already discovered in a previous run — before any Haiku/
        # DDG/Sonnet cost, not just before scoring. Overlapping search windows
        # across runs (widened backfills, daily cron re-covering yesterday's
        # tail) would otherwise re-triage/re-score/re-insert the exact same
        # posting every time. Matched by job_url, so it only catches same-
        # platform reposts/overlap — the same job cross-listed on a different
        # site gets a different URL and isn't caught by this.
        scraped_urls = [j["job_url"] for j in jobs if j.get("job_url")]
        existing_by_url = {}
        if scraped_urls:
            cursor = db.discovered_jobs.find({"job_url": {"$in": scraped_urls}}, {"job_url": 1, "date_posted": 1})
            existing_by_url = {doc["job_url"]: doc.get("date_posted") async for doc in cursor}
        before_dedup = len(jobs)
        already_known_jobs = [j for j in jobs if j.get("job_url") in existing_by_url]
        jobs = [j for j in jobs if j.get("job_url") not in existing_by_url]
        run.jobs_already_known = before_dedup - len(jobs)

        for job in already_known_jobs:
            logger.info("Job skipped: runId=%s jobId=%s reason=%s",
                        run.id, job.get("id"), "already_known")

        # An "already known" job is otherwise fully discarded here — free
        # opportunity to backfill/refresh its stored date_posted from this
        # scrape's fresher attempt (e.g. LinkedIn's own date_posted extraction
        # is intermittently unreliable — see the null-date_posted investigation
        # — so a later re-scrape sometimes succeeds where an earlier one
        # didn't). Only ever moves forward in time: a flaky re-scrape that
        # returns nothing, or an older date than what's already stored, must
        # not regress good data.
        for job in already_known_jobs:
            new_value = _backfill_date_posted(job.get("date_posted"), existing_by_url.get(job.get("job_url")))
            if new_value is None:
                continue
            await db.discovered_jobs.update_one(
                {"job_url": job["job_url"]}, {"$set": {"date_posted": new_value}}
            )
            run.jobs_date_backfilled += 1

        if run.jobs_already_known:
            logger.info("Run %s: skipping %d jobs already discovered in a previous run", run.id, run.jobs_already_known)
        if run.jobs_date_backfilled:
            logger.info("Run %s: backfilled/refreshed date_posted on %d already-known jobs", run.id, run.jobs_date_backfilled)

        # Fail fast before triage/duplicate checks if the API is unreachable,
        # rather than have some call deep into the run be the first to notice.
        if not await tracker_client.check_api_reachable(settings):
            raise RuntimeError("API unreachable — aborting run")

        # Title triage: one Haiku call flags clearly off-target titles
        # (job-board search padding) so they skip embedding. Fails open —
        # on any error every job is kept.
        triage = await match_client.triage_titles(
            settings, ", ".join(criteria.job_titles), jobs
        ) or {}

        def _is_relevant(idx: int) -> bool:
            t = triage.get(jobs[idx]["id"])
            return t is None or t["relevant"]

        relevant_indices = [i for i in range(len(jobs)) if _is_relevant(i)]

        for job in jobs:
            t = triage.get(job["id"])
            kept = t["relevant"] if t else True
            reason = (t or {}).get("reason")
            logger.info("Job triaged: runId=%s jobId=%s kept=%s reason=%s",
                        run.id, job.get("id"), kept, reason)

        # Enrichment prefetch: unique companies across every relevant job,
        # deduped once up front — same prefetch-then-cache pattern the old RAG
        # search path used per-search, just applied to the whole run's
        # relevant set instead of a top-N slice.
        relevant_companies = [jobs[i]["company"] for i in relevant_indices if jobs[i].get("company")]
        news_cache, glassdoor_cache, company_size_cache = await asyncio.gather(
            news_client.prefetch_company_news(relevant_companies),
            glassdoor_client.prefetch_glassdoor_ratings(relevant_companies),
            company_size_client.prefetch_company_sizes(relevant_companies),
        )

        unique_relevant_companies = list(
            {c.strip().lower(): c for c in relevant_companies if c and c.strip()}.values()
        )
        for company in unique_relevant_companies:
            key = company.strip().lower()
            gd = glassdoor_cache.get(key)
            nc = news_cache.get(key)
            sz = company_size_cache.get(key)
            logger.info("Company enriched: runId=%s company=%s glassdoor=%s news=%s size=%s",
                        run.id, company, bool(gd), len(nc or []), bool(sz))

        def _enrich_company_profile(job_data: dict, key: str) -> dict | None:
            # jobspy's LinkedIn scraper never populates numEmployees (only
            # Indeed does) — fill the gap from the DDG-scraped prefetch above,
            # but never overwrite a real jobspy-sourced value. Narrative
            # context for the Evaluator only (PromptSeeds.Evaluator documents
            # company_profile as never changing a numeric score) — company
            # size is not used as a hard filter here.
            profile = dict(job_data.get("company_profile") or {})
            if not profile.get("numEmployees"):
                size = company_size_cache.get(key)
                if size:
                    profile["numEmployees"] = size
            return profile or None

        # Seniority classification: one Haiku call flags each relevant job's
        # actual seniority band (source-agnostic — replaces jobspy's
        # LinkedIn-only job_level as the client-side filter). Only classify
        # jobs that survived triage; fails open (None everywhere) on error.
        relevant_jobs = [jobs[i] for i in relevant_indices]
        # Keyed by jobId directly (assigned at scrape time) — no index remap
        # needed even though classify_seniority only saw relevant_jobs.
        seniority = await match_client.classify_seniority(settings, relevant_jobs) or {}
        for i in relevant_indices:
            logger.info("Job classified: runId=%s jobId=%s seniority=%s",
                        run.id, jobs[i]["id"], seniority.get(jobs[i]["id"]))

        # Duplicate check is cheap and still useful as a flag (the job stays
        # searchable; the UI marks it as already tracked).
        dup_sem = asyncio.Semaphore(5)

        def _base_job(job_data: dict) -> dict:
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
                "actual_job_level": seniority.get(job_data.get("id")),
                "is_remote": job_data.get("is_remote"),
                "company_logo": job_data.get("company_logo"),
                "company_profile": job_data.get("company_profile"),
            }

        async def _insert_triaged_out(job_data: dict):
            try:
                disc_job = DiscoveredJob(
                    **_base_job(job_data),
                    id=job_data.get("id"),
                    triaged_out=True,
                    triage_reason=(triage.get(job_data.get("id")) or {}).get("reason"),
                )
                await db.discovered_jobs.insert_one(disc_job.model_dump())
                run.jobs_triaged_out += 1
            except Exception as e:
                logger.error("Error ingesting triaged-out job '%s': %s", job_data.get("title"), e)

        # Job ids are now generated at scrape time (scraper.py), not here —
        # carried on the job dict since before triage, so triaged-out jobs
        # and "Job scraped"/"Job triaged"/"Job classified" log lines share
        # the same id as the eventually-persisted DiscoveredJob.
        relevant_with_ids = [(jobs[i], jobs[i]["id"]) for i in relevant_indices]
        batch_sem = asyncio.Semaphore(MAX_CONCURRENT_SCORE_BATCHES)

        async def _score_and_insert_batch(chunk: list[tuple[dict, str]]):
            items = []
            enriched_profiles: dict[str, dict | None] = {}
            for job_data, job_id in chunk:
                key = (job_data.get("company") or "").strip().lower()
                profile = _enrich_company_profile(job_data, key)
                enriched_profiles[job_id] = profile
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
                    "companyProfile": profile,
                })

            async with batch_sem:
                scores = await match_client.score_job_batch(settings, items, run_id=run.id)

            for job_data, job_id in chunk:
                try:
                    key = (job_data.get("company") or "").strip().lower()
                    base = _base_job(job_data)
                    base["company_profile"] = enriched_profiles.get(job_id, base["company_profile"])
                    async with dup_sem:
                        is_dup = await tracker_client.check_duplicate(
                            settings, job_data["company"], job_data["title"]
                        )
                    if is_dup:
                        run.jobs_skipped_duplicate += 1

                    match_response = (scores or {}).get(job_id)
                    if match_response is None:
                        run.jobs_score_failed += 1
                        logger.info("Job skipped: runId=%s jobId=%s reason=%s",
                                    run.id, job_id, "score_failed")
                        disc_job = DiscoveredJob(id=job_id, **base, is_duplicate=is_dup)
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
                            **base,
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
                    logger.error("Job skipped: runId=%s jobId=%s reason=%s error=%s",
                                 run.id, job_id, "ingest_error", e)

        chunks = [
            relevant_with_ids[i:i + SCORE_BATCH_SIZE]
            for i in range(0, len(relevant_with_ids), SCORE_BATCH_SIZE)
        ]
        triaged_out_indices = [i for i in range(len(jobs)) if not _is_relevant(i)]
        await asyncio.gather(
            *[_insert_triaged_out(jobs[i]) for i in triaged_out_indices],
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
                "jobs_already_known": run.jobs_already_known,
                "jobs_date_backfilled": run.jobs_date_backfilled,
            }},
        )
        logger.info(
            "Run %s completed: %d scraped, %d already known (%d date-backfilled), %d scored, "
            "%d score-failed, %d duplicates, %d triaged out",
            run.id, run.jobs_scraped, run.jobs_already_known, run.jobs_date_backfilled, run.jobs_scored,
            run.jobs_score_failed, run.jobs_skipped_duplicate, run.jobs_triaged_out,
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
