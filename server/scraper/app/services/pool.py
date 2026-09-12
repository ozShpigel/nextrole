"""The shared job pool's daily ingest.

One run, one pool, everyone. Nothing here reads a profile or scores anything:
the pool is common to every user, so a job's stored facts are a property of the
posting and are computed exactly once (see docs/job-pool.md).

Three things this does that the criteria-driven path does not:

  * **Identity.** Every listing gets a stable `pool_key` so the same posting
    seen on ten runs is one row, not ten.
  * **Presence.** A listing absent from N consecutive runs is marked inactive.
    Never deleted — it stays readable, it just leaves the default view.
  * **Facts.** When a job first enters the pool its stated requirements are
    extracted once, user-independently, and stored beside the raw posting.
"""

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app import roles as roles_config
from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.models.discovery_run import DiscoveryRun
from app.models.search_criteria import SearchCriteria
from app.services import match_client, scraper

logger = logging.getLogger(__name__)

# Extraction is one Haiku call per chunk; the API caps a request at 200 jobs.
EXTRACT_CHUNK_SIZE = 25
MAX_CONCURRENT_EXTRACT_CHUNKS = 2
# A posting whose facts could not be read is retried on later runs, but not
# forever: a permanently unparseable one would otherwise cost a Claude call a
# day for as long as it stays in the pool, and that bill grows with the role
# list. After this many attempts the job stays in the pool unextracted -- it
# still appears in results, it just has no facts to filter on.
MAX_EXTRACT_ATTEMPTS = 3


def pool_key(job: dict) -> str:
    """Stable identity for a listing across runs.

    The board's own URL when there is one — that is the closest thing to a
    primary key a job board offers. Otherwise a hash of company+title+date,
    which is the best available stand-in: it collapses the same posting
    re-scraped on the same day, and deliberately does NOT collapse two
    genuinely different openings for the same title at the same company posted
    on different days.
    """
    url = (job.get("job_url") or "").strip()
    if url:
        return url
    parts = "\x00".join([
        (job.get("company") or "").strip().casefold(),
        (job.get("title") or "").strip().casefold(),
        (job.get("date_posted") or "").strip(),
    ])
    return "k:" + hashlib.sha256(parts.encode("utf-8")).hexdigest()[:32]


async def run_pool_ingest(db: AsyncIOMotorDatabase, settings: Settings) -> DiscoveryRun:
    """Scrape every configured role, fold the results into the shared pool, and
    age out what has stopped appearing."""
    config = roles_config.load(settings.roles_config_path or None)
    # Baseline roles from the file, plus whatever users have grown the pool
    # with, capped — see roles.effective_roles.
    search_roles = await roles_config.effective_roles(db, config)
    run = DiscoveryRun(criteria_id="pool", criteria_name="Shared job pool")
    await db.discovery_runs.insert_one(run.model_dump())
    logger.info("Pool run %s: %d role(s) x %d location(s)",
                run.id, len(search_roles), len(config.locations))

    try:
        jobs, stats = await _scrape(config, search_roles)
        run.jobs_scraped = len(jobs)
        run.searches_total = stats["searches_total"]
        run.searches_failed = stats["searches_failed"]
        run.searches_empty = stats["searches_empty"]

        seen_keys = await _upsert(db, settings, run, jobs)
        await _age_out(db, run, config, seen_keys)

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
    except Exception as e:
        logger.exception("Pool run %s failed", run.id)
        run.status = "failed"
        run.error = str(e)
        run.completed_at = datetime.now(timezone.utc)

    await db.discovery_runs.update_one({"id": run.id}, {"$set": run.model_dump()})
    logger.info(
        "Pool run %s %s: %d scraped, %d new, %d refreshed, %d extracted, %d marked inactive",
        run.id, run.status, run.jobs_scraped, run.jobs_new, run.jobs_already_known,
        run.jobs_extracted, run.jobs_marked_inactive,
    )
    return run


async def _scrape(config: roles_config.RolesConfig, search_roles: list[str]) -> tuple[list[dict], dict]:
    """Reuse the criteria scraper by handing it the role list as its titles.

    Same jobspy wrapper, pacing, NaN handling and is_remote correction the
    existing path already gets — the pool differs in where the titles come
    from (a config file, not a user's saved search), not in how it scrapes.
    """
    as_criteria = SearchCriteria(
        name="Shared job pool",
        job_titles=search_roles,
        locations=config.locations,
        site_names=config.site_names,
        results_wanted=config.results_wanted,
        hours_old=config.hours_old,
        country=config.country,
    )
    return await asyncio.get_running_loop().run_in_executor(
        None, scraper.scrape_for_criteria, as_criteria
    )


async def _upsert(
    db: AsyncIOMotorDatabase, settings: Settings, run: DiscoveryRun, jobs: list[dict]
) -> set[str]:
    """Fold this run's scrape into the pool. Returns every pool_key seen."""
    by_key: dict[str, dict] = {}
    for job in jobs:
        # Within one run the same listing can surface under several role
        # searches; first one wins, the rest are the same posting.
        by_key.setdefault(pool_key(job), job)

    if not by_key:
        return set()

    existing_keys = set()
    cursor = db.discovered_jobs.find({"pool_key": {"$in": list(by_key)}}, {"pool_key": 1})
    async for doc in cursor:
        existing_keys.add(doc["pool_key"])

    now = datetime.now(timezone.utc)

    # Already in the pool: this run is presence evidence, nothing more. Facts
    # are NOT recomputed — that is the whole point of extracting once.
    if existing_keys:
        result = await db.discovered_jobs.update_many(
            {"pool_key": {"$in": list(existing_keys)}},
            {"$set": {
                "is_active": True,
                "missed_runs": 0,
                "last_seen_at": now,
                "last_seen_run_id": run.id,
            }},
        )
        run.jobs_already_known = result.modified_count

    # Facts are never RE-computed for a job that has them. A job still missing
    # them gets a bounded number of further attempts -- see _retry_missing_facts.
    await _retry_missing_facts(db, settings, run, existing_keys, now)

    new_jobs = [j for k, j in by_key.items() if k not in existing_keys]
    if not new_jobs:
        return set(by_key)

    facts = await _extract_facts(settings, new_jobs)

    docs = []
    for job in new_jobs:
        job_facts = facts.get(job["id"])
        docs.append(DiscoveredJob(
            id=job["id"],
            run_id=run.id,
            criteria_id=None,
            title=job["title"],
            company=job["company"],
            location=job.get("location"),
            description=job.get("description"),
            job_url=job.get("job_url"),
            date_posted=job.get("date_posted"),
            site=job.get("site", "linkedin"),
            job_level=job.get("job_level"),
            # One seniority field, one writer: on this path the extraction is
            # it, so nothing downstream has to know which pipeline filled it.
            actual_job_level=(job_facts or {}).get("seniority"),
            is_remote=job.get("is_remote"),
            company_logo=job.get("company_logo"),
            company_profile=job.get("company_profile"),
            ttl_managed=False,
            pool_key=pool_key(job),
            is_active=True,
            missed_runs=0,
            first_seen_at=now,
            last_seen_at=now,
            last_seen_run_id=run.id,
            extracted=job_facts,
            extracted_at=now if job_facts else None,
            extract_attempts=1,
        ).model_dump())

    # ordered=False so one duplicate key (a concurrent run, a pool_key that
    # collided after the existence check) does not abandon the rest of the batch.
    try:
        await db.discovered_jobs.insert_many(docs, ordered=False)
    except Exception as e:
        logger.warning("Pool insert reported errors (continuing): %s", e)

    run.jobs_new = len(docs)
    run.jobs_extracted = sum(1 for d in docs if d.get("extracted"))
    if run.jobs_new != run.jobs_extracted:
        logger.warning(
            "Pool run %s: %d of %d new jobs stored without facts — extraction is retried next run",
            run.id, run.jobs_new - run.jobs_extracted, run.jobs_new,
        )
    return set(by_key)


async def _extract_facts(settings: Settings, new_jobs: list[dict]) -> dict[str, dict]:
    """Read the stated requirements of jobs entering the pool for the first time.

    Chunked and run a couple at a time so a big first run does not arrive at
    the API as one enormous request, mirroring the scoring path's batching.
    A chunk that fails contributes nothing and is simply retried on the next
    run — a posting is worth keeping even when the facts about it are not
    available yet.
    """
    chunks = [new_jobs[i:i + EXTRACT_CHUNK_SIZE] for i in range(0, len(new_jobs), EXTRACT_CHUNK_SIZE)]
    sem = asyncio.Semaphore(MAX_CONCURRENT_EXTRACT_CHUNKS)

    async def one(chunk: list[dict]) -> dict[str, dict]:
        async with sem:
            return await match_client.extract_job_facts(settings, chunk) or {}

    facts: dict[str, dict] = {}
    for result in await asyncio.gather(*[one(c) for c in chunks]):
        facts.update(result)
    return facts


async def _retry_missing_facts(
    db: AsyncIOMotorDatabase,
    settings: Settings,
    run: DiscoveryRun,
    seen_keys: set[str],
    now: datetime,
) -> None:
    """Give jobs that entered the pool without facts another go — up to
    MAX_EXTRACT_ATTEMPTS, then never again.

    Only jobs seen in THIS run are retried: a listing that has gone from the
    boards is not worth spending a call on. The attempt counter is incremented
    whether or not the call succeeds, so a posting the model consistently
    cannot parse costs three calls in its lifetime rather than one a day,
    forever. Jobs already at the cap are not selected, so they cost nothing.
    """
    if not seen_keys:
        return

    candidates = await db.discovered_jobs.find(
        {
            "pool_key": {"$in": list(seen_keys)},
            "extracted": None,
            "extract_attempts": {"$lt": MAX_EXTRACT_ATTEMPTS},
        },
        {"id": 1, "title": 1, "company": 1, "location": 1, "description": 1, "extract_attempts": 1},
    ).to_list(None)
    if not candidates:
        return

    logger.info("Pool run %s: retrying extraction for %d job(s) stored without facts",
                run.id, len(candidates))
    facts = await _extract_facts(settings, candidates)

    extracted = 0
    abandoned = 0
    for job in candidates:
        job_facts = facts.get(job["id"])
        update: dict = {"$inc": {"extract_attempts": 1}}
        if job_facts:
            update["$set"] = {
                "extracted": job_facts,
                "extracted_at": now,
                "actual_job_level": job_facts.get("seniority"),
            }
            extracted += 1
        elif job.get("extract_attempts", 0) + 1 >= MAX_EXTRACT_ATTEMPTS:
            abandoned += 1
        await db.discovered_jobs.update_one({"id": job["id"]}, update)

    run.jobs_extract_retried = len(candidates)
    run.jobs_extracted += extracted
    run.jobs_extract_abandoned = abandoned
    if abandoned:
        logger.warning(
            "Pool run %s: %d job(s) reached %d failed extraction attempts — kept in the pool "
            "unextracted and never retried again (they appear in results with no facts to filter on)",
            run.id, abandoned, MAX_EXTRACT_ATTEMPTS,
        )


async def _age_out(
    db: AsyncIOMotorDatabase,
    run: DiscoveryRun,
    config: roles_config.RolesConfig,
    seen_keys: set[str],
) -> None:
    """Count a miss against every active pool job this run did not see, and
    deactivate the ones that have now missed enough consecutive runs.

    Nothing is deleted, ever. An inactive job keeps its description, its facts
    and its history; it only drops out of the default view. A listing that
    reappears is reactivated with its miss counter reset (see _upsert), so a
    board hiccup costs nothing permanent.

    Scoped to pool jobs (`pool_key` present) so the criteria-driven path's rows
    are left alone.
    """
    absent = {"pool_key": {"$exists": True, "$nin": list(seen_keys)}, "is_active": True}

    bumped = await db.discovered_jobs.update_many(absent, {"$inc": {"missed_runs": 1}})
    run.jobs_missed = bumped.modified_count

    deactivated = await db.discovered_jobs.update_many(
        {
            "pool_key": {"$exists": True},
            "is_active": True,
            "missed_runs": {"$gte": config.missed_runs_before_inactive},
        },
        {"$set": {"is_active": False, "inactive_at": datetime.now(timezone.utc)}},
    )
    run.jobs_marked_inactive = deactivated.modified_count

    if run.jobs_marked_inactive:
        logger.info(
            "Pool run %s: %d listing(s) absent for %d consecutive runs marked inactive (kept, not deleted)",
            run.id, run.jobs_marked_inactive, config.missed_runs_before_inactive,
        )
