import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import certifi
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from app.config import Settings
from app.indexes import ensure_ttl_index
from app.schemas.criteria import (
    MAX_SEARCHES_PER_RUN,
    CreateCriteriaRequest,
    UpdateCriteriaRequest,
    pairs_error,
    search_pairs,
)
from app.models.search_criteria import SearchCriteria
from app.services import match_client, orchestrator, scraper, tracker_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _tag_utc(doc: dict) -> dict:
    """Ensure datetime fields carry UTC tzinfo so JSON serializes with +00:00."""
    for key, val in doc.items():
        if isinstance(val, datetime) and val.tzinfo is None:
            doc[key] = val.replace(tzinfo=timezone.utc)
    return doc

settings = Settings()
db_client: AsyncIOMotorClient | None = None
db = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_client, db
    logger.info("Connecting to MongoDB...")
    db_client = AsyncIOMotorClient(settings.mongodb_connection_string, tlsCAFile=certifi.where())
    db = db_client[settings.mongodb_database_name]
    logger.info("Connected to database: %s", settings.mongodb_database_name)

    # Discovery runs live in FastAPI BackgroundTasks — they die with the
    # process. Render free-tier restarts (deploys, idle eviction, OOM) leave
    # in-process phases frozen forever, showing up as phantom "in-progress"
    # rows. Single-instance service, so on startup any in-process phase is
    # orphaned. ("scoring" is the live per-job-scoring ingest phase again;
    # "parsing"/"finalizing"/"awaiting_batch" are retired batch-era statuses —
    # included so any leftover row from before the RAG migration is also
    # cleaned up. "embedding" is retired RAG-era, same reason.)
    reconciled = await db.discovery_runs.update_many(
        {"status": {"$in": ["pending", "scraping", "embedding",
                            "parsing", "scoring", "finalizing", "awaiting_batch"]}},
        {"$set": {
            "status": "failed",
            "error": "Run orphaned — scraper restarted before completion",
            "completed_at": datetime.now(timezone.utc),
        }},
    )
    if reconciled.modified_count:
        logger.warning(
            "Reconciled %d orphaned discovery run(s) to failed on startup",
            reconciled.modified_count,
        )

    await ensure_ttl_index(db)

    # Demo pool freshness: seeded fictional jobs re-enter the Search page's
    # days-back window on every cold start — which on the free tier happens
    # whenever a visitor arrives — so demo search always has results. No-op
    # outside demo mode or before `python -m app.cli seed-demo-jobs` ran.
    if settings.demo_mode:
        from app.services import demo_seed
        await demo_seed.refresh_seed_timestamps(db)

    yield
    if db_client:
        db_client.close()
        logger.info("MongoDB connection closed")


app = FastAPI(title="Scraper Service", version="0.1.0", lifespan=lifespan)


# DEMO_MODE — public demo instance: block every write (criteria/run/job
# mutations) so visitors can't pollute shared data. GETs (health, list/get
# runs/jobs/criteria) still work. Off by default. Exact-path allowlist for
# POSTs that are pure analysis (no persistence) — mirrors the API's
# analysisAllowlist in Program.cs.
DEMO_ANALYSIS_ALLOWLIST: set[str] = set()

# Matches page "Add": the one persisting write allowed in demo, matched by
# path pattern since the job id is dynamic — mirrors the API's
# resumePackGeneratePath exception in Program.cs. Bounded to the existing
# seeded discovery pool (saving an already-scored job), unlike
# /api/discovery/jobs/import (arbitrary URL scraping) or /unsave, which stay
# blocked. The downstream tracker save this triggers is itself gated on the
# API side by the X-Source: ingest header this service already attaches to
# every scraper→API call, so a client can't reach that write directly.
DEMO_SAVE_JOB_PATTERN = re.compile(r"^/api/discovery/jobs/[0-9a-fA-F-]{36}/save$")


@app.middleware("http")
async def demo_guard(request, call_next):
    path = request.url.path.rstrip("/")
    is_allowed_save = request.method == "POST" and DEMO_SAVE_JOB_PATTERN.match(path)
    if (
        settings.demo_mode
        and request.method in ("POST", "PUT", "PATCH", "DELETE")
        and path not in DEMO_ANALYSIS_ALLOWLIST
        and not is_allowed_save
    ):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=403, content={"error": "This is a read-only demo."})
    return await call_next(request)

# Enable CORS so the frontend can call this service directly from the browser
# (mirrors the candy-babies pattern). Removing the nginx middleman eliminates
# the double-hop retry amplification that was causing Cloudflare 429s on cold
# starts.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.parsed_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

# Two paths return the same payload: `/health` is the conventional Render probe
# target; `/api/discovery/health` matches the prefix the frontend uses for every
# other call, so the client doesn't need to special-case wake-up probes.
@app.get("/health")
@app.get("/api/discovery/health")
async def health():
    return {"status": "ok", "service": "scraper"}


# ---------------------------------------------------------------------------
# Search Criteria CRUD
# ---------------------------------------------------------------------------

@app.get("/api/discovery/criteria")
async def list_criteria():
    docs = await db.search_criteria.find().sort("created_at", -1).to_list(100)
    for d in docs:
        d.pop("_id", None)
    return docs


@app.post("/api/discovery/criteria", status_code=201)
async def create_criteria(req: CreateCriteriaRequest):
    criteria = SearchCriteria(**req.model_dump())
    await db.search_criteria.insert_one(criteria.model_dump())
    return criteria.model_dump()


@app.put("/api/discovery/criteria/{criteria_id}")
async def update_criteria(criteria_id: str, req: UpdateCriteriaRequest):
    updates = req.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    # Partial update: enforce the titles x locations search budget against the
    # merged result (schema-level validation can't see the other half).
    if "job_titles" in updates or "locations" in updates:
        existing = await db.search_criteria.find_one({"id": criteria_id})
        if not existing:
            raise HTTPException(404, "Criteria not found")
        titles = updates.get("job_titles", existing.get("job_titles") or [])
        locations = updates.get("locations", existing.get("locations") or [])
        if search_pairs(titles, locations) > MAX_SEARCHES_PER_RUN:
            raise HTTPException(400, pairs_error(titles, locations))
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.search_criteria.update_one({"id": criteria_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Criteria not found")
    doc = await db.search_criteria.find_one({"id": criteria_id})
    doc.pop("_id", None)
    return doc


@app.delete("/api/discovery/criteria/{criteria_id}", status_code=204)
async def delete_criteria(criteria_id: str):
    result = await db.search_criteria.delete_one({"id": criteria_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Criteria not found")


# ---------------------------------------------------------------------------
# Discovery Runs
# ---------------------------------------------------------------------------

@app.post("/api/discovery/run/{criteria_id}", status_code=202)
async def trigger_run(criteria_id: str, background_tasks: BackgroundTasks):
    doc = await db.search_criteria.find_one({"id": criteria_id})
    if not doc:
        raise HTTPException(404, "Criteria not found")
    from app.models.discovery_run import DiscoveryRun
    run = DiscoveryRun(criteria_id=criteria_id, criteria_name=doc.get("name", ""))
    await db.discovery_runs.insert_one(run.model_dump())
    background_tasks.add_task(orchestrator.run_discovery, db, settings, criteria_id, run.id)
    return {"status": "started", "criteria_id": criteria_id, "run_id": run.id}


@app.get("/api/discovery/runs")
async def list_runs():
    docs = await db.discovery_runs.find().sort("started_at", -1).to_list(20)
    for d in docs:
        d.pop("_id", None)
        _tag_utc(d)
    return docs


@app.get("/api/discovery/runs/{run_id}")
async def get_run(run_id: str):
    doc = await db.discovery_runs.find_one({"id": run_id})
    if not doc:
        raise HTTPException(404, "Run not found")
    doc.pop("_id", None)
    _tag_utc(doc)
    return doc


@app.get("/api/discovery/runs/{run_id}/jobs")
async def get_run_jobs(run_id: str):
    docs = await db.discovered_jobs.find({"run_id": run_id}).sort("score", -1).to_list(200)
    for d in docs:
        d.pop("_id", None)
    return docs


@app.get("/api/discovery/jobs")
async def list_scored_jobs(
    min_score: int | None = None,
    verdict: str | None = None,  # comma-separated, e.g. "STRONG_YES,YES"
    days_back: int = 14,
    criteria_id: str | None = None,
    location: str | None = None,  # free-text substring, case-insensitive
    q: str | None = None,  # free-text search across title/company/description
    is_remote: bool | None = None,
    actual_job_level: str | None = None,  # comma-separated
    include_dismissed: bool = False,
    include_saved: bool = True,
    limit: int = 50,
    offset: int = 0,
):
    """Cross-run browse: the Matches page's primary data source, replacing
    the old on-demand RAG search. Every discovered job is scored at ingest
    time now, so "search" is really "filter/sort what's already scored" —
    this is the query surface for that, distinct from the per-run drill-down
    at GET /api/discovery/runs/{run_id}/jobs.

    Defaults exclude triaged-out and unscored/score-failed jobs (nothing
    useful to show) and dismissed jobs (acted-on, same spirit as the old
    RAG search's acted-on exclusion) — saved jobs stay visible by default
    since "already in my Tracker" isn't the same signal as "not interested."
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    query: dict = {
        "triaged_out": {"$ne": True},
        "score": {"$ne": None},
        "discovered_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=max(1, days_back))},
    }
    if min_score is not None:
        query["score"]["$gte"] = min_score
    if verdict:
        query["verdict"] = {"$in": [v.strip() for v in verdict.split(",") if v.strip()]}
    if criteria_id:
        query["criteria_id"] = criteria_id
    if location and location.strip():
        query["location"] = {"$regex": re.escape(location.strip()), "$options": "i"}
    if q and q.strip():
        pattern = re.escape(q.strip())
        query["$or"] = [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"company": {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
        ]
    if is_remote is not None:
        query["is_remote"] = is_remote
    if actual_job_level:
        query["actual_job_level"] = {"$in": [lvl.strip() for lvl in actual_job_level.split(",") if lvl.strip()]}
    if not include_dismissed:
        query["dismissed"] = {"$ne": True}
    if not include_saved:
        query["saved_to_tracker"] = {"$ne": True}

    total = await db.discovered_jobs.count_documents(query)
    docs = await (
        db.discovered_jobs.find(query)
        .sort("score", -1)
        .skip(offset)
        .limit(limit)
        .to_list(limit)
    )
    for d in docs:
        d.pop("_id", None)
        _tag_utc(d)
    return {"jobs": docs, "total": total, "limit": limit, "offset": offset}


@app.post("/api/discovery/runs/{run_id}/abort")
async def abort_run(run_id: str):
    # Can't actually cancel the in-process BackgroundTask — FastAPI doesn't
    # expose a handle. But marking the row "cancelled" removes the phantom from
    # the UI and frees the user to start a fresh run. The orchestrator's status
    # writes are guarded with `status != cancelled`, so a still-alive zombie
    # task can no longer resurrect the row back to scoring/completed/failed.
    result = await db.discovery_runs.update_one(
        {"id": run_id, "status": {"$in": ["pending", "scraping", "scoring"]}},
        {"$set": {
            "status": "cancelled",
            "error": "Aborted by user",
            "completed_at": datetime.now(timezone.utc),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Run not found or already finished")
    return {"status": "cancelled"}


# ---------------------------------------------------------------------------
# Discovered Jobs Actions
# ---------------------------------------------------------------------------

async def _resolve_company_logo(company: str | None, own_logo: str | None) -> str | None:
    """A company's logo doesn't change between postings, so if this job's own
    scrape has none, fall back to any other discovered job for the same
    company that does — instead of saving a permanently blank one."""
    if own_logo or not company:
        return own_logo
    doc = await db.discovered_jobs.find_one(
        {"company": {"$regex": f"^{re.escape(company)}$", "$options": "i"}, "company_logo": {"$ne": None}},
        {"company_logo": 1},
        sort=[("discovered_at", -1)],
    )
    return doc.get("company_logo") if doc else None


async def _enrich_saved_job(job_id: str, app_id: str, doc: dict) -> None:
    """Background follow-up to save_job(): upgrades the 4 terse narrative
    fields to full detail after the Add click has already returned, instead
    of blocking it on a Claude call chain that can take 40-60s+ with retries
    and no client-side loading feedback. Best-effort — a failure here just
    leaves the terse content saved, which AnalysisCard renders fine either
    way (every section guards on its own field's presence)."""
    match_analysis = doc.get("match_analysis")
    if not match_analysis or match_analysis.get("overallScore") is None:
        return
    enriched = await match_client.enrich_narrative(settings, doc)
    if not enriched:
        return
    updated = {
        **match_analysis,
        "honestAssessment": enriched.get("honestAssessment", match_analysis.get("honestAssessment")),
        "recommendation": {
            **(match_analysis.get("recommendation") or {}),
            **(enriched.get("recommendation") or {}),
        },
        **({"companyNewsAnalysis": enriched["companyNewsAnalysis"]} if enriched.get("companyNewsAnalysis") else {}),
        **({"employeeReviewsAnalysis": enriched["employeeReviewsAnalysis"]} if enriched.get("employeeReviewsAnalysis") else {}),
    }
    await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"match_analysis": updated}})
    await tracker_client.update_match_analysis(settings, app_id, json.dumps(updated, ensure_ascii=False))


@app.post("/api/discovery/jobs/{job_id}/save")
async def save_job(job_id: str, background_tasks: BackgroundTasks):
    doc = await db.discovered_jobs.find_one({"id": job_id})
    if not doc:
        raise HTTPException(404, "Job not found")
    if doc.get("saved_to_tracker"):
        return {"status": "already_saved"}

    match_analysis = doc.get("match_analysis")
    analysis_json = json.dumps(match_analysis, ensure_ascii=False) if match_analysis else None

    app_id = await tracker_client.save_to_tracker(
        settings=settings,
        title=doc["title"],
        company=doc["company"],
        description=doc.get("description"),
        score=doc.get("score"),
        verdict=doc.get("verdict"),
        analysis_json=analysis_json,
        job_url=doc.get("job_url"),
        analyst_snapshot_input=doc.get("analyst_snapshot_input"),
        analyst_snapshot_output=doc.get("analyst_snapshot_output"),
        evaluator_snapshot_input=doc.get("evaluator_snapshot_input"),
        evaluator_snapshot_output=doc.get("evaluator_snapshot_output"),
        company_news=doc.get("company_news"),
        glassdoor_data=doc.get("glassdoor_data"),
        company_logo=await _resolve_company_logo(doc.get("company"), doc.get("company_logo")),
    )
    if not app_id:
        raise HTTPException(500, "Failed to save to tracker")

    await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"saved_to_tracker": True}})
    # Fired now that the job is actually being added (~4% of scored jobs
    # reach this path), but AFTER responding — see _enrich_saved_job.
    background_tasks.add_task(_enrich_saved_job, job_id, app_id, doc)
    return {"status": "saved"}


@app.post("/api/discovery/jobs/{job_id}/dismiss")
async def dismiss_job(job_id: str):
    result = await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"dismissed": True}})
    if result.matched_count == 0:
        raise HTTPException(404, "Job not found")
    return {"status": "dismissed"}


class UnsaveJobRequest(BaseModel):
    job_url: str


@app.post("/api/discovery/jobs/unsave")
async def unsave_job(request: UnsaveJobRequest):
    # Reverse of save_job. The tracker Application has no reference back to
    # the discovered_jobs _id — only the job's URL (Application.JobUrl) — so
    # when the API deletes an Application it can't clear this flag itself;
    # the client calls this right after DELETE /applications/{id} so the job
    # doesn't stay permanently hidden from Search/re-add. update_many (not
    # update_one): job_url isn't a unique index, so a re-scraped posting can
    # legitimately have more than one discovered_jobs doc.
    if not request.job_url.strip():
        raise HTTPException(400, "job_url is required")
    result = await db.discovered_jobs.update_many(
        {"job_url": request.job_url}, {"$set": {"saved_to_tracker": False}}
    )
    return {"status": "unsaved", "modified": result.modified_count}


class ImportJobsRequest(BaseModel):
    urls: list[str]


MAX_IMPORT_URLS = 5  # matches the Evaluator batch cap (see match_client.score_job_batch)


@app.post("/api/discovery/jobs/import")
async def import_jobs(request: ImportJobsRequest):
    """The "Import Job" button on Active — one or more LinkedIn job URLs
    found outside of discovery. Fetches each directly (no search), scores
    them in one batch call, and saves straight to the tracker at
    DecidedToApply, landing in the Added column. Never raises on a
    per-job failure (bad link, fetch blocked, scoring unavailable) — those
    are reported per-URL in the response instead, same fail-open philosophy
    as the discovery pipeline; a bad link in a batch of five shouldn't lose
    the other four.
    """
    urls = [u.strip() for u in request.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "At least one URL is required")
    if len(urls) > MAX_IMPORT_URLS:
        raise HTTPException(400, f"At most {MAX_IMPORT_URLS} URLs per import")

    loop = asyncio.get_running_loop()
    results: list[dict] = []
    fetched: list[tuple[str, dict]] = []
    for url in urls:
        job = await loop.run_in_executor(None, scraper.fetch_job_by_url, url)
        if job is None:
            results.append({
                "url": url, "status": "failed", "title": None, "company": None,
                "error": "Couldn't fetch this job — check the link, or paste the description instead.",
            })
            continue
        fetched.append((url, job))

    if fetched:
        batch_items = [
            {
                "id": str(i),
                "jobDescription": job["description"],
                "title": job["title"],
                "company": job["company"],
                "location": job.get("location"),
                "companyProfile": job.get("company_profile"),
            }
            for i, (_url, job) in enumerate(fetched)
        ]
        scores = await match_client.score_job_batch(settings, batch_items)

        for i, (url, job) in enumerate(fetched):
            match_response = (scores or {}).get(str(i))
            score = verdict = analysis_json = None
            analyst_in = analyst_out = eval_in = eval_out = None
            if match_response:
                score = match_response.get("overallScore")
                verdict = match_response.get("verdict")
                analysis = {
                    k: v for k, v in match_response.items()
                    if k not in ("analystSnapshotInput", "analystSnapshotOutput",
                                 "evaluatorSnapshotInput", "evaluatorSnapshotOutput")
                }
                analysis_json = json.dumps(analysis, ensure_ascii=False)
                analyst_in = match_response.get("analystSnapshotInput")
                analyst_out = match_response.get("analystSnapshotOutput")
                eval_in = match_response.get("evaluatorSnapshotInput")
                eval_out = match_response.get("evaluatorSnapshotOutput")

            saved = await tracker_client.save_to_tracker(
                settings=settings,
                title=job["title"],
                company=job["company"],
                description=job["description"],
                score=score,
                verdict=verdict,
                analysis_json=analysis_json,
                job_url=job["job_url"],
                analyst_snapshot_input=analyst_in,
                analyst_snapshot_output=analyst_out,
                evaluator_snapshot_input=eval_in,
                evaluator_snapshot_output=eval_out,
                company_logo=await _resolve_company_logo(job.get("company"), job.get("company_logo")),
            )
            results.append({
                "url": url,
                "status": "saved" if saved else "failed",
                "title": job["title"],
                "company": job["company"],
                "score": score,
                "verdict": verdict,
                "error": None if saved else "Scored, but couldn't save it to the tracker.",
            })

    return {"results": results}
