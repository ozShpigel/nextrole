import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import Settings
from app.models.api_models import CreateCriteriaRequest, UpdateCriteriaRequest
from app.models.search_criteria import SearchCriteria
from app.services import match_client, orchestrator, tracker_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings()
db_client: AsyncIOMotorClient | None = None
db = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_client, db
    logger.info("Connecting to MongoDB...")
    db_client = AsyncIOMotorClient(settings.mongodb_connection_string)
    db = db_client[settings.mongodb_database_name]
    logger.info("Connected to database: %s", settings.mongodb_database_name)

    # Discovery runs live in FastAPI BackgroundTasks — they die with the
    # process. Render free-tier restarts (deploys, idle eviction, OOM) leave
    # runs frozen in pending/scraping/scoring forever, which shows up in the
    # UI as phantom "in-progress" rows. We're a single-instance service, so
    # on startup any non-terminal run is guaranteed orphaned.
    reconciled = await db.discovery_runs.update_many(
        {"status": {"$in": ["pending", "scraping", "scoring"]}},
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

    yield
    if db_client:
        db_client.close()
        logger.info("MongoDB connection closed")


app = FastAPI(title="Scraper Service", lifespan=lifespan)

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
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
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
    background_tasks.add_task(orchestrator.run_discovery, db, settings, criteria_id)
    return {"status": "started", "criteria_id": criteria_id}


@app.get("/api/discovery/runs")
async def list_runs():
    docs = await db.discovery_runs.find().sort("started_at", -1).to_list(20)
    for d in docs:
        d.pop("_id", None)
    return docs


@app.get("/api/discovery/runs/{run_id}")
async def get_run(run_id: str):
    doc = await db.discovery_runs.find_one({"id": run_id})
    if not doc:
        raise HTTPException(404, "Run not found")
    doc.pop("_id", None)
    return doc


@app.get("/api/discovery/runs/{run_id}/jobs")
async def get_run_jobs(run_id: str):
    docs = await db.discovered_jobs.find({"run_id": run_id}).sort("score", -1).to_list(200)
    for d in docs:
        d.pop("_id", None)
    return docs


@app.post("/api/discovery/runs/{run_id}/abort")
async def abort_run(run_id: str):
    # Can't actually cancel the in-process BackgroundTask — FastAPI doesn't
    # expose a handle. But marking the row failed removes the phantom from
    # the UI and frees the user to start a fresh run. If the zombie task is
    # somehow still alive, its final update_one will just no-op on a row
    # that's already in a terminal state.
    result = await db.discovery_runs.update_one(
        {"id": run_id, "status": {"$in": ["pending", "scraping", "scoring"]}},
        {"$set": {
            "status": "failed",
            "error": "Aborted by user",
            "completed_at": datetime.now(timezone.utc),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Run not found or already finished")
    return {"status": "aborted"}


# ---------------------------------------------------------------------------
# Discovered Jobs Actions
# ---------------------------------------------------------------------------

def _extract_flat(match_analysis: dict) -> tuple[int | None, str | None, bool | None]:
    """Mirror of orchestrator._extract_flat — pull flat fields for persistence."""
    score = match_analysis.get("overallScore")
    verdict = match_analysis.get("verdict")
    recommendation = match_analysis.get("recommendation") or {}
    should_apply = recommendation.get("shouldApply")
    return score, verdict, should_apply


@app.post("/api/discovery/jobs/{job_id}/rescore")
async def rescore_job(job_id: str):
    """Re-run match scoring on a single MATCH_FAILED job.

    Intended for the retry button on the run detail page — lets the user
    recover from transient API failures (cold-start, rate-limit, timeout)
    without re-scraping. Only acts on jobs that failed the match call;
    INSUFFICIENT_DATA (description too short) and already-scored jobs are
    rejected so this can't accidentally overwrite real analysis.
    """
    doc = await db.discovered_jobs.find_one({"id": job_id})
    if not doc:
        raise HTTPException(404, "Job not found")
    # Accept INSUFFICIENT_DATA too — legacy rows from runs that failed before
    # we split the two verdicts are tagged INSUFFICIENT_DATA even when the
    # root cause was an API outage. If the description really is too short,
    # score_job returns "too_short" cheaply and we re-tag it as-is.
    if doc.get("verdict") not in ("MATCH_FAILED", "INSUFFICIENT_DATA"):
        raise HTTPException(409, "Job is not in a rescorable state")
    if doc.get("score") is not None:
        raise HTTPException(409, "Job already has a score")

    result = await match_client.score_job(
        settings=settings,
        title=doc["title"],
        company=doc["company"],
        location=doc.get("location"),
        description=doc.get("description"),
        date_posted=doc.get("date_posted"),
        site=doc.get("site", "linkedin"),
    )

    if result.status == "too_short":
        # Edge case — wouldn't normally hit this path since we already
        # returned MATCH_FAILED above, but stay defensive.
        await db.discovered_jobs.update_one(
            {"id": job_id},
            {"$set": {"verdict": "INSUFFICIENT_DATA"}},
        )
        return {"status": "insufficient_data"}

    if result.status == "api_error":
        raise HTTPException(503, "API still unreachable — try again in a moment")

    score, verdict, should_apply = _extract_flat(result.data)
    await db.discovered_jobs.update_one(
        {"id": job_id},
        {"$set": {
            "score": score,
            "verdict": verdict,
            "should_apply": should_apply,
            "match_analysis": result.data,
        }},
    )
    return {"status": "ok", "score": score, "verdict": verdict}


@app.post("/api/discovery/jobs/{job_id}/save")
async def save_job(job_id: str):
    doc = await db.discovered_jobs.find_one({"id": job_id})
    if not doc:
        raise HTTPException(404, "Job not found")
    if doc.get("saved_to_tracker"):
        return {"status": "already_saved"}

    match_analysis = doc.get("match_analysis")
    analysis_json = json.dumps(match_analysis, ensure_ascii=False) if match_analysis else None

    saved = await tracker_client.save_to_tracker(
        settings=settings,
        title=doc["title"],
        company=doc["company"],
        description=doc.get("description"),
        score=doc.get("score"),
        verdict=doc.get("verdict"),
        analysis_json=analysis_json,
    )
    if saved:
        await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"saved_to_tracker": True}})
        return {"status": "saved"}
    raise HTTPException(500, "Failed to save to tracker")


@app.post("/api/discovery/jobs/{job_id}/dismiss")
async def dismiss_job(job_id: str):
    result = await db.discovered_jobs.update_one({"id": job_id}, {"$set": {"dismissed": True}})
    if result.matched_count == 0:
        raise HTTPException(404, "Job not found")
    return {"status": "dismissed"}
