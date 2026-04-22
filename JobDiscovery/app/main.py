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
from app.services import orchestrator, tracker_client

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
    yield
    if db_client:
        db_client.close()
        logger.info("MongoDB connection closed")


app = FastAPI(title="Job Discovery Service", lifespan=lifespan)

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
    return {"status": "ok", "service": "job-discovery"}


# Temporary probe: hits JobMatchService + ApplicationTracker via Render's
# private-network hostnames to verify that inter-service calls can skip
# Cloudflare. Remove once JOB_MATCH_SERVICE_URL / APPLICATION_TRACKER_BASE_URL
# have been switched to the internal URLs.
@app.get("/api/discovery/debug/internal-probe")
async def internal_probe():
    import httpx

    # Render's private DNS uses the service's slug. Service slug is often the
    # display name kebab-cased, but rename history can pin it to the original.
    # Cast a wide net — whichever resolves wins.
    targets = {
        "match_job-matcher":                "http://job-matcher:8080/health",
        "match_job-match-service-latest":   "http://job-match-service-latest:8080/health",
        "tracker_tracker":                  "http://tracker:8080/health",
        "tracker_application-tracker-latest": "http://application-tracker-latest:8080/health",
        "tracker_application-tracker-latest-b8l9": "http://application-tracker-latest-b8l9:8080/health",
        # Public baseline: if these don't return 200 either, it's a warm-up
        # issue, not a routing issue.
        "match_public":     "https://job-match-service-latest.onrender.com/health",
        "tracker_public":   "https://application-tracker-latest-b8l9.onrender.com/health",
    }
    results = {}
    async with httpx.AsyncClient(timeout=8.0) as client:
        for name, url in targets.items():
            try:
                resp = await client.get(url)
                results[name] = {
                    "url": url,
                    "status": resp.status_code,
                    "body": resp.text[:200],
                }
            except Exception as e:
                results[name] = {"url": url, "error": f"{type(e).__name__}: {e}"}
    return results


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
