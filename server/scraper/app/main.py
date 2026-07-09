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
from app.schemas.search import SearchRequest
from app.models.search_criteria import SearchCriteria
from app.services import orchestrator, search, tracker_client

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
    # orphaned. (scoring/parsing/finalizing/awaiting_batch are retired batch-era
    # statuses — included so any leftover row from before the RAG migration is
    # also cleaned up.)
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

    # Retention: purge discovered jobs after 45 days so the M0 tier (512MB)
    # never fills up. Safe — jobs saved to the tracker are full copies in the
    # tracker DB. NOTE: the first sweep bulk-deletes everything already older
    # than 45 days. create_index is idempotent for an identical spec.
    try:
        await db.discovered_jobs.create_index(
            "discovered_at",
            expireAfterSeconds=45 * 24 * 3600,
            name="ttl_discovered_at_45d",
        )
    except Exception as e:
        logger.warning("TTL index ensure failed (continuing): %s", e)

    yield
    if db_client:
        db_client.close()
        logger.info("MongoDB connection closed")


app = FastAPI(title="Scraper Service", lifespan=lifespan)


# DEMO_MODE — public demo instance: block every write (criteria/run/job
# mutations) so visitors can't pollute shared data. GETs (health, list/get
# runs/jobs/criteria) still work. Off by default. Exact-path allowlist for
# POSTs that are pure analysis (no persistence) — mirrors the API's
# analysisAllowlist in Program.cs.
DEMO_ANALYSIS_ALLOWLIST = {"/api/search"}


@app.middleware("http")
async def demo_guard(request, call_next):
    if (
        settings.demo_mode
        and request.method in ("POST", "PUT", "PATCH", "DELETE")
        and request.url.path.rstrip("/") not in DEMO_ANALYSIS_ALLOWLIST
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
    # expose a handle. But marking the row "cancelled" removes the phantom from
    # the UI and frees the user to start a fresh run. The orchestrator's status
    # writes are guarded with `status != cancelled`, so a still-alive zombie
    # task can no longer resurrect the row back to scoring/completed/failed.
    result = await db.discovery_runs.update_one(
        {"id": run_id, "status": {"$in": ["pending", "scraping", "embedding"]}},
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
# Semantic Search (RAG)
# ---------------------------------------------------------------------------

@app.post("/api/search")
async def search_endpoint(req: SearchRequest):
    """On-demand semantic job search: the user's profile is embedded and
    matched against stored jobs via Atlas $vectorSearch (hard filters applied
    in-index), then ONE Claude call ranks the top-N as a career-advisor brief.
    Read-only analysis — nothing is persisted."""
    return await search.search_jobs(db, settings, req)


# ---------------------------------------------------------------------------
# Discovered Jobs Actions
# ---------------------------------------------------------------------------

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
