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


async def get_search_queries(settings: Settings) -> tuple[list[dict], str]:
    """The query facets to embed for $vectorSearch, plus their source.

    Preferred: the HyDE ideal-posting facets (`/api/match/profile/search-query`
    — the profile rewritten as 1-3 job postings, one per role facet;
    posting-vs-posting comparison closes the résumé↔posting genre gap, and
    per-facet queries keep secondary facets from being averaged away). The API
    caches them per profile version, so a cache miss costs one Claude call.
    Falls back to the raw rendered profile as a single facet so search degrades
    rather than breaks. Returns ([{name, text}], "hyde" | "profile").
    """
    resp = await _request_with_retry(
        "GET",
        f"{settings.api_base_url}/api/match/profile/search-query",
        # Cache miss triggers a Claude generation — allow for it.
        timeout=120.0,
        operation="search-query",
    )
    if resp is not None and resp.status_code == 200:
        facets = (resp.json() or {}).get("facets") or []
        queries = [
            {"name": f.get("name") or f"facet-{i + 1}", "text": f["content"]}
            for i, f in enumerate(facets)
            if isinstance(f, dict) and (f.get("content") or "").strip()
        ]
        if queries:
            return queries, "hyde"
    logger.warning("HyDE search queries unavailable — falling back to the raw profile")
    profile = await get_profile_text(settings)
    return ([{"name": "profile", "text": profile}] if profile else []), "profile"


# Reciprocal Rank Fusion constant — the standard damping value; higher k
# flattens the difference between adjacent ranks.
RRF_K = 60


def fuse_rankings(rankings: list[tuple[str, list[dict]]], k: int = RRF_K) -> list[dict]:
    """Merge per-facet $vectorSearch results with Reciprocal Rank Fusion.

    rankings: [(facet_name, hits best-first)]. A job's fused score is
    sum(1/(k + rank)) over the facets that returned it, so a strong showing in
    ONE facet outranks mediocre showings in all — the point of multi-vector
    retrieval. Output is deduped (by job_url, falling back to id), best-first;
    each hit carries `facet_ranks` {facet: rank} and its best `similarity`
    across facets.
    """
    fused: dict[str, dict] = {}
    for facet_name, hits in rankings:
        rank = 0
        seen: set[str] = set()
        for h in hits:
            key = h.get("job_url") or h.get("id") or ""
            if not key or key in seen:
                continue
            seen.add(key)
            rank += 1
            entry = fused.setdefault(key, {"hit": h, "score": 0.0, "facet_ranks": {}})
            entry["score"] += 1.0 / (k + rank)
            entry["facet_ranks"][facet_name] = rank
            if (h.get("similarity") or 0) > (entry["hit"].get("similarity") or 0):
                entry["hit"] = h
    ordered = sorted(
        fused.values(),
        key=lambda e: (-e["score"], -(e["hit"].get("similarity") or 0)),
    )
    out = []
    for e in ordered:
        hit = dict(e["hit"])
        hit["facet_ranks"] = e["facet_ranks"]
        out.append(hit)
    return out


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
    queries, query_source = await get_search_queries(settings)
    if not queries:
        raise HTTPException(503, "Profile unavailable — set up your profile in Settings first")
    logger.info("Search query source: %s (%d facet(s))", query_source, len(queries))

    vectors = await embeddings.embed_texts(settings, [q["text"] for q in queries])
    if any(v is None for v in vectors):
        raise HTTPException(502, "Failed to embed the search queries — check OPENAI_API_KEY")

    # One $vectorSearch per facet, then Reciprocal Rank Fusion — a job that
    # matches ONE facet strongly outranks jobs that match all facets weakly.
    rankings: list[tuple[str, list[dict]]] = []
    for q, vector in zip(queries, vectors):
        pipeline = build_vector_pipeline(
            vector,
            limit=req.limit,
            days_back=req.days_back,
            is_remote=req.is_remote,
            job_levels=req.job_levels,
            sites=req.sites,
        )
        try:
            facet_hits = await db.discovered_jobs.aggregate(pipeline).to_list(req.limit * OVERFETCH_FACTOR)
        except Exception as e:
            # Most common cause: the Atlas vector index isn't created/Active yet.
            logger.error("$vectorSearch failed: %s", e)
            raise HTTPException(
                503,
                f"Vector search unavailable — is the Atlas index '{VECTOR_INDEX_NAME}' created and Active?",
            )
        rankings.append((q["name"], facet_hits))

    hits = fuse_rankings(rankings)
    if req.location:
        needle = req.location.lower()
        hits = [h for h in hits if needle in (h.get("location") or "").lower()]
    hits = hits[: req.limit]

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
