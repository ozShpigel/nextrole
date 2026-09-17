import asyncio
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
from app.models.scrape_spec import ScrapeSpec
from app.services import scraper

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

    # Index management moved to the API in Phase 3b of
    # docs/scraper-slimming.md -- PoolIndexInitializer. This service no longer
    # shapes the collections it writes, which is the step before it stops
    # holding a database credential at all.
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


class ScrapeUrlRequest(BaseModel):
    url: str


@app.post("/scrape/url")
async def scrape_url(request: ScrapeUrlRequest):
    """Fetch one LinkedIn posting directly by URL -- a link found outside of
    discovery, not a search.

    Returns `{"job": null}` rather than an error status on a failed fetch. A bad
    link, an expired posting and a changed page structure are all ordinary
    outcomes here, not faults of this service, and the caller reports them per
    URL. 404 would make the caller's own error handling ambiguous with a
    genuinely missing route.
    """
    job = await asyncio.get_running_loop().run_in_executor(
        None, scraper.fetch_job_by_url, request.url
    )
    if job is None:
        logger.info("Could not fetch job from %s", request.url)
    return {"job": job}


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

