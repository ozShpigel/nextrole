import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException
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


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "service": "job-discovery"}


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
    # Run in background; orchestrator creates its own DiscoveryRun record
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

    import json
    analysis = json.dumps({
        "score": doc.get("score"),
        "verdict": doc.get("verdict"),
        "shouldApply": doc.get("should_apply"),
        "keyStrengths": doc.get("key_strengths", []),
        "keyConcerns": doc.get("key_concerns", []),
        "honestAssessment": doc.get("honest_assessment", ""),
    }, ensure_ascii=False)

    saved = await tracker_client.save_to_tracker(
        settings=settings,
        title=doc["title"],
        company=doc["company"],
        description=doc.get("description"),
        score=doc.get("score"),
        verdict=doc.get("verdict"),
        analysis_json=analysis,
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
