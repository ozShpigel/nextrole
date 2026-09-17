import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import certifi
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from app.config import Settings
from app import identity, roles
from app.indexes import ensure_pool_indexes, ensure_ttl_index, ensure_user_scope
from app.models.scrape_spec import ScrapeSpec
from app.services import match_client, scraper, tracker_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _tag_utc(doc: dict) -> dict:
    """Ensure datetime fields carry UTC tzinfo so JSON serializes with +00:00."""
    for key, val in doc.items():
        if isinstance(val, datetime) and val.tzinfo is None:
            doc[key] = val.replace(tzinfo=timezone.utc)
    return doc

settings = Settings()
identity.validate(settings)
db_client: AsyncIOMotorClient | None = None
db = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_client, db
    logger.info("Connecting to MongoDB...")
    # tlsCAFile IMPLIES tls=True in PyMongo, so passing it unconditionally makes
    # a plain mongodb://localhost connection fail the handshake — which is what
    # a local Mongo container is. Atlas (mongodb+srv://) needs the CA bundle;
    # nothing else here does.
    conn = settings.mongodb_connection_string
    tls_opts = (
        {"tlsCAFile": certifi.where()}
        if conn.startswith("mongodb+srv://") or "tls=true" in conn.lower() or "ssl=true" in conn.lower()
        else {}
    )
    db_client = AsyncIOMotorClient(conn, **tls_opts)
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
    await ensure_user_scope(db, identity.legacy_owner_user_id(settings))
    await ensure_pool_indexes(db)
    await roles.publish_baseline(db, roles.load(settings.roles_config_path or None))

    yield
    if db_client:
        db_client.close()
        logger.info("MongoDB connection closed")


app = FastAPI(title="Scraper Service", version="0.1.0", lifespan=lifespan)


# Enable CORS so the frontend can call this service directly from the browser
# (mirrors the candy-babies pattern). Removing the nginx middleman eliminates
# the double-hop retry amplification that was causing Cloudflare 429s on cold
# starts.
# allow_credentials is on only when the origins are explicit: a browser
# refuses to send the uid cookie to a wildcard origin, and CORS forbids
# pairing "*" with credentials at all. A cookie-mode deploy therefore has to
# list its frontend origins in CORS_ORIGINS.
_cors_origins = settings.parsed_cors_origins()
_allow_credentials = _cors_origins != ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Resolved once per request, the same way the API resolves it.
#
# One dependency now: the only user-scoped endpoint left is import_jobs, and it
# calls the API, so it needs the CREDENTIAL rather than the resolved id -- the
# API will not accept an id (see identity.RequestIdentity). The id-only
# dependency went with the endpoints that queried Mongo directly, which moved
# to the API in Phase 1/1b of docs/scraper-slimming.md.
async def current_identity(request: Request) -> identity.RequestIdentity:
    # Async because resolution is now a session lookup (docs/auth.md). FastAPI
    # awaits async dependencies transparently, so no handler signature changes.
    return await identity.resolve(settings, request, db)


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
# Scrape — the jobspy adapter
#
# The one thing in this service that genuinely needs Python. PoolIngest (.NET)
# calls it; nothing else does, and no browser can reach it — nginx proxies only
# what the client uses, and this is container-to-container over Docker DNS.
#
# Stateless by construction: parameters in, listings out. It touches no
# database, resolves no identity and makes no decisions. Everything the daily
# run decides — what is new, what to keep, what to extract, what to age out —
# lives in PoolIngest (docs/scraper-slimming.md).
# ---------------------------------------------------------------------------

class ScrapeRequest(BaseModel):
    job_titles: list[str]
    locations: list[str] = []
    site_names: list[str] = ["linkedin"]
    results_wanted: int = 50
    hours_old: int = 72
    country: str = "Israel"
    is_remote: bool | None = None


@app.post("/scrape")
async def scrape(request: ScrapeRequest):
    """Run jobspy for every (title x location) pair and return what it found.

    Synchronous library, so it goes to a thread. The pacing inside
    scrape_for_criteria (8-20s between searches) means a full role list takes
    minutes -- the caller is a cron process with no user waiting, which is why
    this may be a plain blocking request rather than a job queue.

    `stats` is the throttling signal: jobspy swallows rate-limit errors, so
    failed and empty search counts are the only evidence a run was blocked.
    """
    spec = ScrapeSpec(**request.model_dump())
    jobs, stats = await asyncio.get_running_loop().run_in_executor(
        None, scraper.scrape_for_criteria, spec
    )
    logger.info("Scrape returned %d job(s) over %d search(es)", len(jobs), stats["searches_total"])
    return {"jobs": jobs, "stats": stats}


# ---------------------------------------------------------------------------
# Discovery Runs
#
# Read-only. The criteria CRUD, the per-criteria trigger and the per-run
# drill-down went with the criteria-driven ingest (docs/scraper-slimming.md,
# Phase 0). Runs are still written — by the daily pool ingest — so listing
# them stays useful for seeing whether last night's run completed.
# ---------------------------------------------------------------------------

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



# ---------------------------------------------------------------------------
# Discovered Jobs Actions
# ---------------------------------------------------------------------------

class ImportJobsRequest(BaseModel):
    urls: list[str]


MAX_IMPORT_URLS = 5  # matches the Evaluator batch cap (see match_client.score_job_batch)


@app.post("/api/discovery/jobs/import")
async def import_jobs(request: ImportJobsRequest, ident: identity.RequestIdentity = Depends(current_identity)):
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
        # Scored against this user's profile, and saved to this user's
        # tracker — both need the identity forwarded, not just the save.
        scores = await match_client.score_job_batch(settings, batch_items, identity=ident)

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
                identity=ident,
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
