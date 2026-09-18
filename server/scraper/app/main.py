"""The jobspy adapter.

Parameters in, listings out. No database, no identity, no decisions -- every
choice the daily run makes (what is new, what to keep, what to extract, what to
age out) lives in PoolIngest, and every user-scoped route lives in the API.

This is what is left after docs/scraper-slimming.md: the one part of the old
scraper that genuinely needs Python, because jobspy is a Python library. It went
from 4,907 lines to this.

Nothing here holds a credential. That is the point -- a service that parses
hostile HTML should not also hold readWrite on two production databases.
"""
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import Settings
from app.models.scrape_spec import ScrapeSpec
from app.services import scraper

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings()

app = FastAPI(title="Scraper Service", version="0.2.0")

# The browser does not call this service at all any more (Phase 3a), so CORS is
# vestigial -- kept only so a local dev setup pointing a browser straight at it
# keeps working. Credentials are never sent: there is no cookie to send.
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
