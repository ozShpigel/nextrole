import asyncio
import logging
from datetime import datetime, timezone
from typing import NamedTuple

from motor.motor_asyncio import AsyncIOMotorDatabase

from app import identity
from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.models.discovery_run import DiscoveryRun
from app.models.search_criteria import SearchCriteria
from app.services import company_size_client, glassdoor_client, match_client, news_client, pool, scraper, tracker_client

logger = logging.getLogger(__name__)

# Batched-scoring cost design: N jobs per Evaluator call (well under the API's
# hard cap of 5) share one system-prompt/profile input cost instead of N —
# the whole point of batching over one-call-per-job. Concurrent in-flight
# batches are capped separately (not just relying on the API's own rate
# limiter) so a big run doesn't fire dozens of calls at once — a starting,
# unmeasured estimate; tune against a real run before trusting a daily cron.
SCORE_BATCH_SIZE = 4
MAX_CONCURRENT_SCORE_BATCHES = 2

# The tracker duplicate check is one API round trip per relevant job, so a
# 60-job run makes 60 of them; this caps how many are in flight at once.
MAX_CONCURRENT_DUP_CHECKS = 5


class _RunContext(NamedTuple):
    """Everything that stays constant for the duration of one discovery run.

    `run` is the mutable part: each phase records its own counters and status
    fields on it, and they are written back to Mongo once, at completion.
    """

    db: AsyncIOMotorDatabase
    settings: Settings
    criteria: SearchCriteria
    run: DiscoveryRun


class _Enrichment(NamedTuple):
    """Per-company context fetched once per run and shared by every job at that
    company. All three are keyed by `_company_key` (company name, stripped and
    lowercased), not by job id."""

    news: dict
    glassdoor: dict
    company_size: dict


def _company_key(job_data: dict) -> str:
    return (job_data.get("company") or "").strip().lower()


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


def _is_relevant(job_data: dict, triage: dict) -> bool:
    """Triage fails open: a job with no verdict is kept and scored."""
    verdict = triage.get(job_data["id"])
    return verdict is None or verdict["relevant"]


async def run_discovery(db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str, run_id: str | None = None):
    """Execute a discovery run: scrape, triage, classify seniority, store.

    RAG/vector-search matching was removed — per-job Evaluator scoring is the
    primary matching path again (added as a batched-scoring step below).

    Each step below is one `_phase` function. They run in sequence, take the
    jobs they operate on as an argument, and record their own outcome on
    `ctx.run`; only `_open_run`, `_scrape`, `_mark_completed` and `_mark_failed`
    write run state to Mongo.
    """
    ctx = await _open_run(db, settings, criteria_id, run_id)
    if ctx is None:
        return

    try:
        jobs = await _scrape(ctx)
        jobs = await _drop_already_known(ctx, jobs)

        # Fail fast before triage/duplicate checks if the API is unreachable,
        # rather than have some call deep into the run be the first to notice.
        if not await tracker_client.check_api_reachable(settings):
            raise RuntimeError("API unreachable — aborting run")

        triage = await _triage_titles(ctx, jobs)
        relevant_jobs = [j for j in jobs if _is_relevant(j, triage)]
        triaged_out_jobs = [j for j in jobs if not _is_relevant(j, triage)]

        enrichment = await _prefetch_enrichment(ctx, relevant_jobs)
        seniority = await _classify_seniority(ctx, relevant_jobs)

        await _store_jobs(ctx, relevant_jobs, triaged_out_jobs, triage, seniority, enrichment)
        await _mark_completed(ctx)

    except Exception as e:
        await _mark_failed(ctx, e)


async def _open_run(
    db: AsyncIOMotorDatabase, settings: Settings, criteria_id: str, run_id: str | None
) -> _RunContext | None:
    """Load the criteria, then resume the caller's DiscoveryRun or open a new
    one. Returns None if the criteria no longer exists — nothing to run.

    Deliberately outside run_discovery's try/except: if the run record itself
    can't be written there is no run to mark failed.
    """
    criteria_doc = await db.search_criteria.find_one({"id": criteria_id})
    if not criteria_doc:
        logger.error("Criteria %s not found", criteria_id)
        return None

    criteria = SearchCriteria(**criteria_doc)
    if run_id:
        run_doc = await db.discovery_runs.find_one({"id": run_id})
        run = DiscoveryRun(**{k: v for k, v in run_doc.items() if k != "_id"}) if run_doc else DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name)
    else:
        run = DiscoveryRun(criteria_id=criteria.id, criteria_name=criteria.name)
        await db.discovery_runs.insert_one(run.model_dump())
    run.status = "scraping"
    await db.discovery_runs.update_one({"id": run.id}, {"$set": {"status": "scraping"}})
    return _RunContext(db=db, settings=settings, criteria=criteria, run=run)


async def _scrape(ctx: _RunContext) -> list[dict]:
    """Run jobspy for the criteria. Synchronous library, so it goes to a thread."""
    run, criteria = ctx.run, ctx.criteria
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
    await ctx.db.discovery_runs.update_one(
        {"id": run.id, "status": {"$ne": "cancelled"}},
        {"$set": {
            "status": "scoring",
            "jobs_scraped": len(jobs),
            "searches_total": run.searches_total,
            "searches_failed": run.searches_failed,
            "searches_empty": run.searches_empty,
        }},
    )
    return jobs


async def _drop_already_known(ctx: _RunContext, jobs: list[dict]) -> list[dict]:
    """Skip jobs already discovered in a previous run — before any Haiku/
    DDG/Sonnet cost, not just before scoring. Overlapping search windows
    across runs (widened backfills, daily cron re-covering yesterday's
    tail) would otherwise re-triage/re-score/re-insert the exact same
    posting every time. Matched by job_url, so it only catches same-
    platform reposts/overlap — the same job cross-listed on a different
    site gets a different URL and isn't caught by this.
    """
    db, run = ctx.db, ctx.run
    scraped_urls = [j["job_url"] for j in jobs if j.get("job_url")]
    existing_by_url = {}
    if scraped_urls:
        cursor = db.discovered_jobs.find({"job_url": {"$in": scraped_urls}}, {"job_url": 1, "date_posted": 1})
        existing_by_url = {doc["job_url"]: doc.get("date_posted") async for doc in cursor}
    before_dedup = len(jobs)
    already_known_jobs = [j for j in jobs if j.get("job_url") in existing_by_url]
    remaining_jobs = [j for j in jobs if j.get("job_url") not in existing_by_url]
    run.jobs_already_known = before_dedup - len(remaining_jobs)

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
    return remaining_jobs


async def _triage_titles(ctx: _RunContext, jobs: list[dict]) -> dict:
    """Batched Haiku calls flag clearly off-target titles (job-board search
    padding) so they skip scoring. Fails open — on any error every job is
    kept. That is the right default for relevance but the expensive one for
    cost, so the outcome is recorded on the run: a silent triage failure is a
    ~2x ingest bill that looks like a normal run in jobs_triaged_out alone.
    """
    run = ctx.run
    search_intent = ", ".join(ctx.criteria.job_titles)
    triage = await match_client.triage_titles(ctx.settings, search_intent, jobs) or {}
    if not jobs or not search_intent:
        run.triage_status = "skipped"
    elif not triage:
        run.triage_status = "failed"
        run.triage_unresolved = len(jobs)
    else:
        run.triage_unresolved = sum(1 for j in jobs if j["id"] not in triage)
        run.triage_status = "partial" if run.triage_unresolved else "ok"
    if run.triage_status in ("failed", "partial"):
        logger.error(
            "Run %s: title triage %s — %d/%d jobs have no verdict and will be "
            "scored unfiltered",
            run.id, run.triage_status, run.triage_unresolved, len(jobs),
        )

    for job in jobs:
        t = triage.get(job["id"])
        kept = t["relevant"] if t else True
        reason = (t or {}).get("reason")
        logger.info("Job triaged: runId=%s jobId=%s kept=%s reason=%s",
                    run.id, job.get("id"), kept, reason)
    return triage


async def _prefetch_enrichment(ctx: _RunContext, relevant_jobs: list[dict]) -> _Enrichment:
    """Unique companies across every relevant job, deduped once up front —
    same prefetch-then-cache pattern the old RAG search path used per-search,
    just applied to the whole run's relevant set instead of a top-N slice.
    """
    run = ctx.run
    relevant_companies = [j["company"] for j in relevant_jobs if j.get("company")]
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

    return _Enrichment(news=news_cache, glassdoor=glassdoor_cache, company_size=company_size_cache)


async def _classify_seniority(ctx: _RunContext, relevant_jobs: list[dict]) -> dict:
    """Batched Haiku calls flag each relevant job's actual seniority band
    (source-agnostic — replaces jobspy's LinkedIn-only job_level as the
    client-side filter). Only classifies jobs that survived triage; fails open
    (None everywhere) on error. Keyed by jobId directly (assigned at scrape
    time) — no index remap needed even though it only saw relevant_jobs.
    """
    run = ctx.run
    seniority = await match_client.classify_seniority(ctx.settings, relevant_jobs) or {}
    if not relevant_jobs:
        run.seniority_status = "skipped"
    elif not seniority:
        run.seniority_status = "failed"
        run.seniority_unresolved = len(relevant_jobs)
    else:
        run.seniority_unresolved = sum(
            1 for j in relevant_jobs if j["id"] not in seniority
        )
        run.seniority_status = "partial" if run.seniority_unresolved else "ok"
    if run.seniority_status in ("failed", "partial"):
        logger.error(
            "Run %s: seniority classification %s — %d/%d jobs unlabelled, the "
            "seniority filter will not exclude them",
            run.id, run.seniority_status, run.seniority_unresolved, len(relevant_jobs),
        )
    for job in relevant_jobs:
        logger.info("Job classified: runId=%s jobId=%s seniority=%s",
                    run.id, job["id"], seniority.get(job["id"]))
    return seniority


def _run_identity(ctx: _RunContext) -> identity.RequestIdentity | None:
    """The identity this run can PROVE to the API, or None.

    A run is a background task: there is no request behind it and so no session
    token. Under Fixed mode that costs nothing — the API takes its user from
    configuration and ignores the cookie — so the criteria's owner is a sound
    answer.

    Under Cookie mode there is no answer. Sending the owner's userId would not
    be rejected; the API would mint a throwaway identity, and the dedup check
    would then ask an empty tracker whether it already holds this job and be
    told no, every time, forever. A skipped check leaves `is_duplicate` false,
    which is the same answer that lie produces — arrived at honestly, and
    without a per-job round trip that can only mislead.
    """
    if ctx.settings.identity_mode != "fixed":
        return None
    # Whose tracker — the owner of the criteria this run is for. An unowned
    # criteria predates multi-user and is attributed the same way the migration
    # attributes it.
    owner = ctx.criteria.user_id or identity.legacy_owner_user_id(ctx.settings)
    return identity.RequestIdentity(user_id=owner, credential=owner)


def _company_profile(job_data: dict, enrichment: _Enrichment) -> dict | None:
    """jobspy's LinkedIn scraper never populates numEmployees (only Indeed
    does) — fill the gap from the DDG-scraped prefetch, but never overwrite a
    real jobspy-sourced value. Narrative context for the Evaluator only
    (PromptSeeds.Evaluator documents company_profile as never changing a
    numeric score) — company size is not used as a hard filter here.
    """
    profile = dict(job_data.get("company_profile") or {})
    if not profile.get("numEmployees"):
        size = enrichment.company_size.get(_company_key(job_data))
        if size:
            profile["numEmployees"] = size
    return profile or None


def _base_job(ctx: _RunContext, job_data: dict, seniority: dict) -> dict:
    """The DiscoveredJob fields every stored job gets.

    Criteria-driven runs feed the SAME shared pool the daily run does: same
    pool_key identity, same presence lifecycle, same exemption from the
    deletion TTL. Without that these jobs would be scored by nothing (ingest
    no longer scores) and scanned by nothing (the per-user scan reads the
    pool), which is a dead end. What is left of this path is a manual way to
    pull an ad-hoc search into the pool. See docs/job-pool.md.
    """
    now = datetime.now(timezone.utc)
    return {
        "run_id": ctx.run.id,
        "criteria_id": ctx.criteria.id,
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
        "pool_key": pool.pool_key(job_data),
        "ttl_managed": False,
        "is_active": True,
        "missed_runs": 0,
        "first_seen_at": now,
        "last_seen_at": now,
        "last_seen_run_id": ctx.run.id,
    }


async def _store_jobs(
    ctx: _RunContext,
    relevant_jobs: list[dict],
    triaged_out_jobs: list[dict],
    triage: dict,
    seniority: dict,
    enrichment: _Enrichment,
) -> None:
    """Persist every scraped job: the triaged-out ones as flagged records, the
    rest with their stated requirements extracted. Both fan out concurrently,
    each under its own cap. Nothing here scores — see _extract_and_insert_batch.

    Job ids are generated at scrape time (scraper.py), not here — carried on
    the job dict since before triage, so triaged-out jobs and the "Job
    scraped"/"Job triaged"/"Job classified" log lines share the same id as the
    eventually-persisted DiscoveredJob.
    """
    batch_sem = asyncio.Semaphore(MAX_CONCURRENT_SCORE_BATCHES)
    dup_sem = asyncio.Semaphore(MAX_CONCURRENT_DUP_CHECKS)
    chunks = [
        relevant_jobs[i:i + SCORE_BATCH_SIZE]
        for i in range(0, len(relevant_jobs), SCORE_BATCH_SIZE)
    ]
    await asyncio.gather(
        *[_insert_triaged_out(ctx, job_data, triage, seniority) for job_data in triaged_out_jobs],
        *[
            _extract_and_insert_batch(ctx, chunk, seniority, enrichment, batch_sem, dup_sem)
            for chunk in chunks
        ],
    )


async def _insert_triaged_out(ctx: _RunContext, job_data: dict, triage: dict, seniority: dict) -> None:
    try:
        disc_job = DiscoveredJob(
            **_base_job(ctx, job_data, seniority),
            id=job_data.get("id"),
            triaged_out=True,
            triage_reason=(triage.get(job_data.get("id")) or {}).get("reason"),
        )
        await ctx.db.discovered_jobs.insert_one(disc_job.model_dump())
        ctx.run.jobs_triaged_out += 1
    except Exception as e:
        logger.error("Error ingesting triaged-out job '%s': %s", job_data.get("title"), e)


async def _extract_and_insert_batch(
    ctx: _RunContext,
    chunk: list[dict],
    seniority: dict,
    enrichment: _Enrichment,
    batch_sem: asyncio.Semaphore,
    dup_sem: asyncio.Semaphore,
) -> None:
    """Store a batch of scraped jobs in the shared pool.

    Ingest does NOT score. Scoring is per user and on demand — a pool job is
    scored the first time a user whose filter it passes opens the match tab
    (PoolScanService). Ingest reads only what the posting itself states, once,
    user-independently, exactly as the daily pool run does.
    """
    run = ctx.run
    enriched_profiles: dict[str, dict | None] = {}
    for job_data in chunk:
        enriched_profiles[job_data["id"]] = _company_profile(job_data, enrichment)

    async with batch_sem:
        facts = await match_client.extract_job_facts(ctx.settings, chunk) or {}

    now = datetime.now(timezone.utc)
    for job_data in chunk:
        job_id = job_data["id"]
        try:
            key = _company_key(job_data)
            base = _base_job(ctx, job_data, seniority)
            base["company_profile"] = enriched_profiles.get(job_id, base["company_profile"])

            # Still a useful flag even though nothing is scored: the UI marks
            # a job the user already tracks.
            is_dup = False
            dup_identity = _run_identity(ctx)
            if dup_identity is not None:
                async with dup_sem:
                    is_dup = await tracker_client.check_duplicate(
                        ctx.settings, job_data["company"], job_data["title"],
                        identity=dup_identity,
                    )
            if is_dup:
                run.jobs_skipped_duplicate += 1

            job_facts = facts.get(job_id)
            if job_facts:
                run.jobs_extracted += 1
                base["actual_job_level"] = job_facts.get("seniority") or base.get("actual_job_level")

            disc_job = DiscoveredJob(
                id=job_id,
                **base,
                is_duplicate=is_dup,
                extracted=job_facts,
                extracted_at=now if job_facts else None,
                extract_attempts=1,
                company_news=enrichment.news.get(key) or None,
                glassdoor_data=enrichment.glassdoor.get(key),
            )
            await ctx.db.discovered_jobs.insert_one(disc_job.model_dump())
            run.jobs_new += 1
        except Exception as e:
            logger.error("Job skipped: runId=%s jobId=%s reason=%s error=%s",
                         run.id, job_id, "ingest_error", e)

async def _mark_completed(ctx: _RunContext) -> None:
    run = ctx.run
    run.status = "completed"
    run.completed_at = datetime.now(timezone.utc)
    await ctx.db.discovery_runs.update_one(
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
            "triage_status": run.triage_status,
            "triage_unresolved": run.triage_unresolved,
            "seniority_status": run.seniority_status,
            "seniority_unresolved": run.seniority_unresolved,
        }},
    )
    logger.info(
        "Run %s completed: %d scraped, %d already known (%d date-backfilled), %d scored, "
        "%d score-failed, %d duplicates, %d triaged out (triage=%s, seniority=%s)",
        run.id, run.jobs_scraped, run.jobs_already_known, run.jobs_date_backfilled, run.jobs_scored,
        run.jobs_score_failed, run.jobs_skipped_duplicate, run.jobs_triaged_out,
        run.triage_status, run.seniority_status,
    )


async def _mark_failed(ctx: _RunContext, error: Exception) -> None:
    logger.error("Run %s failed: %s", ctx.run.id, error)
    await ctx.db.discovery_runs.update_one(
        {"id": ctx.run.id, "status": {"$ne": "cancelled"}},
        {"$set": {
            "status": "failed",
            "error": str(error),
            "completed_at": datetime.now(timezone.utc),
        }},
    )
