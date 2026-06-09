import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import certifi
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import Settings
from app.schemas.criteria import CreateCriteriaRequest, UpdateCriteriaRequest
from app.models.search_criteria import SearchCriteria
from app.services import glassdoor_client, match_client, news_client, orchestrator, tracker_client
from app.utils.match_utils import extract_flat

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
    updates = req.model_dump(exclude_unset=True)
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

@app.post("/api/discovery/jobs/{job_id}/rescore")
async def rescore_job(job_id: str):
    """Re-run match scoring on a single job — overwrites any existing score.

    Originally a retry for MATCH_FAILED, now also used to iterate on the
    Evaluator prompt: re-running the same job reveals how prompt changes
    move the score. The existing result is replaced in place.
    """
    doc = await db.discovered_jobs.find_one({"id": job_id})
    if not doc:
        raise HTTPException(404, "Job not found")

    company_news = await news_client.fetch_company_news(doc["company"]) or None
    glassdoor_data = await glassdoor_client.fetch_glassdoor_rating(doc["company"])

    result = await match_client.score_job(
        settings=settings,
        title=doc["title"],
        company=doc["company"],
        location=doc.get("location"),
        description=doc.get("description"),
        date_posted=doc.get("date_posted"),
        site=doc.get("site", "linkedin"),
        company_news=company_news,
        glassdoor_data=glassdoor_data,
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

    score, verdict, should_apply = extract_flat(result.data)
    await db.discovered_jobs.update_one(
        {"id": job_id},
        {"$set": {
            "score": score,
            "verdict": verdict,
            "should_apply": should_apply,
            "match_analysis": result.data,
            "company_news": company_news,
            "glassdoor_data": glassdoor_data,
            "analyst_snapshot_input": result.data.get("analystSnapshotInput"),
            "analyst_snapshot_output": result.data.get("analystSnapshotOutput"),
            "evaluator_snapshot_input": result.data.get("evaluatorSnapshotInput"),
            "evaluator_snapshot_output": result.data.get("evaluatorSnapshotOutput"),
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
        job_url=doc.get("job_url"),
        analyst_snapshot_input=doc.get("analyst_snapshot_input"),
        analyst_snapshot_output=doc.get("analyst_snapshot_output"),
        evaluator_snapshot_input=doc.get("evaluator_snapshot_input"),
        evaluator_snapshot_output=doc.get("evaluator_snapshot_output"),
        company_news=doc.get("company_news"),
        glassdoor_data=doc.get("glassdoor_data"),
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
