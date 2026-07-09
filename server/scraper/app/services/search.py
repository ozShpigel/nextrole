import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.schemas.search import SearchRequest
from app.services import embeddings, glassdoor_client, match_client, news_client
from app.services.tracker_client import _request_with_retry

logger = logging.getLogger(__name__)

VECTOR_INDEX_NAME = "jobs_vector_index"
# $vectorSearch over-fetch factor: headroom for the free-text location
# post-filter and job_url dedupe to still fill `limit`.
OVERFETCH_FACTOR = 3


async def get_profile_text(settings: Settings) -> str | None:
    """Fetch the rendered <professional_profile> content from the API."""
    resp = await _request_with_retry(
        "GET",
        f"{settings.api_base_url}/api/match/profile",
        timeout=60.0,
        operation="profile",
    )
    if resp is None or resp.status_code != 200:
        return None
    content = (resp.json() or {}).get("content")
    return content if content and content.strip() else None


def build_vector_pipeline(
    query_vector: list[float],
    *,
    limit: int,
    days_back: int,
    is_remote: bool | None = None,
    job_levels: list[str] | None = None,
    sites: list[str] | None = None,
) -> list[dict]:
    """Compose the $vectorSearch aggregation for the semantic job search."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    conds: list[dict] = [{"discovered_at": {"$gte": cutoff}}]
    if is_remote is not None:
        conds.append({"is_remote": is_remote})
    if job_levels:
        conds.append({"job_level": {"$in": job_levels}})
    if sites:
        conds.append({"site": {"$in": sites}})
    overfetch = limit * OVERFETCH_FACTOR
    return [
        {"$vectorSearch": {
            "index": VECTOR_INDEX_NAME,
            "path": "job_embedding",
            "queryVector": query_vector,
            # Recall knob — well under the 10k cap; ANN quality degrades if
            # this gets close to overfetch.
            "numCandidates": max(200, overfetch * 15),
            "limit": overfetch,
            "filter": {"$and": conds},
        }},
        {"$addFields": {"similarity": {"$meta": "vectorSearchScore"}}},
        {"$project": {"_id": 0, "job_embedding": 0}},
    ]


def _dedupe_by_url(hits: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for h in hits:
        url = h.get("job_url") or ""
        if url and url in seen:
            continue
        if url:
            seen.add(url)
        out.append(h)
    return out


def _to_advisor_job(hit: dict, news_cache: dict, glassdoor_cache: dict) -> dict:
    key = (hit.get("company") or "").strip().lower()
    return {
        "id": hit["id"],
        "title": hit.get("title"),
        "company": hit.get("company"),
        "location": hit.get("location"),
        "jobLevel": hit.get("job_level"),
        "jobUrl": hit.get("job_url"),
        "datePosted": hit.get("date_posted"),
        "similarity": hit.get("similarity"),
        "description": hit.get("description"),
        "companyNews": news_cache.get(key) or None,
        "glassdoorData": glassdoor_cache.get(key),
    }


async def search_jobs(db: AsyncIOMotorDatabase, settings: Settings, req: SearchRequest) -> dict:
    """On-demand semantic search: profile embedding -> $vectorSearch ->
    top-N enrichment -> one advisor Claude call (via the API)."""
    profile = await get_profile_text(settings)
    if not profile:
        raise HTTPException(503, "Profile unavailable — set up your profile in Settings first")

    [query_vector] = await embeddings.embed_texts(settings, [profile])
    if query_vector is None:
        raise HTTPException(502, "Failed to embed the profile — check OPENAI_API_KEY")

    pipeline = build_vector_pipeline(
        query_vector,
        limit=req.limit,
        days_back=req.days_back,
        is_remote=req.is_remote,
        job_levels=req.job_levels,
        sites=req.sites,
    )
    try:
        hits = await db.discovered_jobs.aggregate(pipeline).to_list(req.limit * OVERFETCH_FACTOR)
    except Exception as e:
        # Most common cause: the Atlas vector index isn't created/Active yet.
        logger.error("$vectorSearch failed: %s", e)
        raise HTTPException(
            503,
            f"Vector search unavailable — is the Atlas index '{VECTOR_INDEX_NAME}' created and Active?",
        )

    if req.location:
        needle = req.location.lower()
        hits = [h for h in hits if needle in (h.get("location") or "").lower()]
    hits = _dedupe_by_url(hits)[: req.limit]

    if not hits:
        return {"jobs": [], "advisor": None}

    # Enrich only the top-N companies — moved here from ingest so enrichment
    # runs ~N times per search instead of once per scraped job, and is fresh.
    companies = [h["company"] for h in hits if h.get("company")]
    news_cache, glassdoor_cache = await asyncio.gather(
        news_client.prefetch_company_news(companies),
        glassdoor_client.prefetch_glassdoor_ratings(companies),
    )

    advisor = await match_client.advise(
        settings, [_to_advisor_job(h, news_cache, glassdoor_cache) for h in hits]
    )
    if advisor is None:
        raise HTTPException(502, "Advisor call failed — try again in a moment")

    return {"jobs": hits, "advisor": advisor}
