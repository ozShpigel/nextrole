import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import certifi
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from app.config import Settings
from app import identity, roles
from app.indexes import ensure_pool_indexes, ensure_ttl_index, ensure_user_scope
from app.services import match_client, pool_state, scraper, tracker_client

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


# Resolved once per request, the same way the API resolves it. Endpoints take
# the id as a parameter so a criteria query cannot be written without one.
#
# Two dependencies, one resolution. A handler that only queries Mongo wants the
# id; a handler that calls the API needs the credential too, because the API
# will not accept an id (see identity.RequestIdentity). Depend on
# `current_identity` whenever the handler makes an outbound user-scoped call.
async def current_identity(request: Request) -> identity.RequestIdentity:
    # Async because resolution is now a session lookup (docs/auth.md). FastAPI
    # awaits async dependencies transparently, so no handler signature changes.
    return await identity.resolve(settings, request, db)


async def current_user_id(request: Request) -> str:
    return (await identity.resolve(settings, request, db)).user_id


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
    user_id: str = Depends(current_user_id),
):
    """Cross-run browse: the Matches page's primary data source.

    Scores are PER USER now (docs/scoring-and-search.md). The pool document
    says what a posting is; this user's `jobScores` row says what it is worth
    to them, and a pool job with no row for this user has simply never been
    scored for them yet — the match tab's scan is what creates those rows.

    So the score/verdict filters and the sort run against the user's own rows,
    not against a shared `score` field that no longer exists on pool documents.
    The join is done here rather than with $lookup because the sort key lives
    in the joined collection: a user has at most a few hundred scored jobs, so
    loading their rows and merging in memory is both simpler and cheaper than
    an aggregation pipeline that would have to sort after the lookup anyway.

    Defaults exclude triaged-out and dismissed jobs (acted-on) — saved jobs
    stay visible by default since "already in my Tracker" isn't the same
    signal as "not interested."
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    # This user's scores first: they decide which pool jobs are even eligible.
    score_query: dict = {"UserId": user_id, "Score": {"$ne": None}}
    if min_score is not None:
        score_query["Score"]["$gte"] = min_score
    if verdict:
        score_query["Verdict"] = {"$in": [v.strip() for v in verdict.split(",") if v.strip()]}
    score_rows = await db.jobScores.find(
        score_query, {"JobId": 1, "Score": 1, "Verdict": 1, "ShouldApply": 1, "MatchAnalysis": 1}
    ).to_list(None)
    if not score_rows:
        return {"jobs": [], "total": 0, "limit": limit, "offset": offset}
    by_job = {r["JobId"]: r for r in score_rows}

    query: dict = {
        "id": {"$in": list(by_job)},
        "triaged_out": {"$ne": True},
    }
    # Recency still applies, and still means what the control says it means.
    # Pool jobs date from first_seen_at; rows written before the pool existed
    # only have discovered_at, so either satisfies it.
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days_back))
    query["$and"] = [{"$or": [
        {"first_seen_at": {"$gte": cutoff}},
        {"first_seen_at": {"$exists": False}, "discovered_at": {"$gte": cutoff}},
    ]}]
    if criteria_id:
        query["criteria_id"] = criteria_id
    if location and location.strip():
        query["location"] = {"$regex": re.escape(location.strip()), "$options": "i"}
    if q and q.strip():
        pattern = re.escape(q.strip())
        query["$and"].append({"$or": [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"company": {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
        ]})
    if is_remote is not None:
        query["is_remote"] = is_remote
    if actual_job_level:
        query["actual_job_level"] = {"$in": [lvl.strip() for lvl in actual_job_level.split(",") if lvl.strip()]}
    # Dismissed/saved are per-user (app/services/pool_state.py), so they are
    # applied to this user's own rows rather than to the shared pool document
    # — which also keeps the $in list below smaller.
    state = await pool_state.state_for(db, user_id, list(by_job))
    if not include_dismissed:
        for job_id, st in state.items():
            if st["dismissed"]:
                by_job.pop(job_id, None)
    if not include_saved:
        for job_id, st in state.items():
            if st["saved"]:
                by_job.pop(job_id, None)
    if not by_job:
        return {"jobs": [], "total": 0, "limit": limit, "offset": offset}
    query["id"] = {"$in": list(by_job)}

    docs = await db.discovered_jobs.find(query).to_list(None)
    for d in docs:
        d.pop("_id", None)
        _tag_utc(d)
        row = by_job.get(d["id"], {})
        # The per-user verdict, presented under the field names the client has
        # always read — nothing downstream needs to know the score moved.
        d["score"] = row.get("Score")
        d["verdict"] = row.get("Verdict")
        d["should_apply"] = row.get("ShouldApply")
        # Same field names the client has always read, filled from this
        # user's row instead of the shared document.
        st = state.get(d["id"], {})
        d["dismissed"] = st.get("dismissed", False)
        d["saved_to_tracker"] = st.get("saved", False)
        analysis = row.get("MatchAnalysis")
        if analysis:
            try:
                d["match_analysis"] = json.loads(analysis)
            except (TypeError, ValueError):
                d["match_analysis"] = None

    docs.sort(key=lambda d: (d.get("score") or 0), reverse=True)
    total = len(docs)
    return {"jobs": docs[offset:offset + limit], "total": total, "limit": limit, "offset": offset}



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


@app.post("/api/discovery/jobs/{job_id}/save")
async def save_job(job_id: str, ident: identity.RequestIdentity = Depends(current_identity)):
    """Add a pool job to this user's tracker.

    The identity has to travel with the outbound call, and it has to be the
    CREDENTIAL rather than the resolved id: the API turns the uid cookie into
    an owner itself, and a server-to-server POST carrying anything it cannot
    resolve does not fail — it files the application under a freshly minted id,
    which is a row no one can ever see again. That is what a raw userId became
    once the cookie started carrying a session token.
    """
    user_id = ident.user_id
    doc = await db.discovered_jobs.find_one({"id": job_id})
    if not doc:
        raise HTTPException(404, "Job not found")
    if await pool_state.is_saved(db, user_id, job_id):
        return {"status": "already_saved"}

    # The score is this user's, and it does not live on the pool document.
    # Ingest stopped scoring when the pool became shared (docs/job-pool.md), so
    # discovered_jobs.score / .verdict / .match_analysis are permanently None on
    # every job either ingest path writes. Reading them here silently dropped
    # the verdict the user was looking at when they clicked Add: the tracked
    # application arrived with matchScore, matchVerdict and matchAnalysis all
    # null, which is also the breakdown the Active board promises to show.
    #
    # Source them from the same jobScores row the Matches list renders from.
    # A missing row means this job was never scored for this user (Add is
    # reachable from a listing that only shows scored jobs, so this is the
    # unusual path, not the normal one) -- save it unscored rather than refuse.
    score_row = await db.jobScores.find_one(
        {"UserId": user_id, "JobId": job_id},
        {"Score": 1, "Verdict": 1, "MatchAnalysis": 1},
    ) or {}
    # Already a JSON string on JobScore, unlike the BSON document the pool used
    # to hold -- json.dumps here would double-encode it into a quoted blob.
    analysis_json = score_row.get("MatchAnalysis")

    app_id = await tracker_client.save_to_tracker(
        settings=settings,
        identity=ident,
        title=doc["title"],
        company=doc["company"],
        description=doc.get("description"),
        score=score_row.get("Score"),
        verdict=score_row.get("Verdict"),
        analysis_json=analysis_json,
        job_url=doc.get("job_url"),
        # The four raw Claude call snapshots are deliberately not passed. They
        # were written by ingest-time scoring, which no longer exists, and
        # JobScore has no field for them, so there is nothing per-user left to
        # recover -- passing doc.get(...) only made four always-null arguments
        # look like real ones. import_jobs still passes real snapshots; it
        # scores inline in the same request.
        company_news=doc.get("company_news"),
        glassdoor_data=doc.get("glassdoor_data"),
        company_logo=await _resolve_company_logo(doc.get("company"), doc.get("company_logo")),
    )
    if not app_id:
        raise HTTPException(500, "Failed to save to tracker")

    await pool_state.mark_saved(db, user_id, job_id)
    # Full-narrative enrichment no longer fires here — the API now defers it
    # to the first time this application's status crosses into an
    # interviewing stage (ApplicationEndpoints.EnrichNarrativeOnInterviewingAsync),
    # since most added jobs never reach one.
    return {"status": "saved"}


@app.post("/api/discovery/jobs/{job_id}/view", status_code=204)
async def mark_job_viewed(job_id: str, user_id: str = Depends(current_user_id)):
    """Record that this user opened this job's detail panel.

    Exists to answer a question nothing could answer before: of the jobs we
    pay to score, how many does anyone actually look at. Scored-versus-acted-on
    was the only available proxy and it is a poor one -- across the two real
    users it reads 86% and 0%.

    Deliberately cheap and deliberately dumb. No existence check on the job: a
    stale id from an open tab writes one orphan row rather than costing a round
    trip to Mongo on every selection, and an orphan row is harmless (nothing
    joins from poolJobState outward). 204 rather than a body, because the
    client has nothing to do with the answer.
    """
    await pool_state.mark_viewed(db, user_id, job_id)


@app.post("/api/discovery/jobs/{job_id}/dismiss")
async def dismiss_job(job_id: str, user_id: str = Depends(current_user_id)):
    """Hide a pool job from this user's Matches. Per user: the posting stays
    in the shared pool and stays visible to everyone else."""
    if not await db.discovered_jobs.find_one({"id": job_id}, {"_id": 1}):
        raise HTTPException(404, "Job not found")
    await pool_state.mark_dismissed(db, user_id, job_id)
    return {"status": "dismissed"}


class UnsaveJobRequest(BaseModel):
    job_url: str


@app.post("/api/discovery/jobs/unsave")
async def unsave_job(request: UnsaveJobRequest, user_id: str = Depends(current_user_id)):
    # Reverse of save_job. The tracker Application has no reference back to
    # the discovered_jobs _id — only the job's URL (Application.JobUrl) — so
    # when the API deletes an Application it can't clear this flag itself;
    # the client calls this right after DELETE /applications/{id} so the job
    # doesn't stay permanently hidden from Search/re-add. update_many (not
    # update_one): job_url isn't a unique index, so a re-scraped posting can
    # legitimately have more than one discovered_jobs doc.
    if not request.job_url.strip():
        raise HTTPException(400, "job_url is required")
    job_ids = [d["id"] for d in await db.discovered_jobs.find(
        {"job_url": request.job_url}, {"id": 1}).to_list(None)]
    modified = await pool_state.clear_saved(db, user_id, job_ids)
    return {"status": "unsaved", "modified": modified}


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
