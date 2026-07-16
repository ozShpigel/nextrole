"""Golden-set recall evaluation for the semantic-search retrieval stage.

Retrieval is the silent failure surface of the RAG search: a well-matched job
that $vectorSearch never surfaces simply doesn't exist as far as the advisor
is concerned, and nothing records the miss. This eval uses the tracker as
ground truth — every application with a job URL is a job the user actually
chose to pursue — and asks: where does each one rank in vector space against
the current profile embedding, over the current pool?

Caveats to keep in mind when reading the report:
- Ranks are pool-wide and unfiltered; a real search ranks within a days_back
  window (a smaller pool), so at-the-time ranks were likely equal or better.
- The 45-day TTL purges old discovered jobs — older applications fall into
  NOT IN POOL and aren't measurable.
- The profile may have changed since the application was saved.

Run: python -m app.cli eval-recall
"""
import logging
import statistics

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.services import embeddings, search

logger = logging.getLogger(__name__)

DEFAULT_KS = (15, 30, 50)
# Atlas caps numCandidates at 10k; pinning it there makes the ANN scan
# effectively exhaustive for any pool that fits the free tier.
MAX_VECTOR_LIMIT = 10_000


def _hit(result: dict, k: int) -> bool:
    rank = result.get("rank")
    return rank is not None and rank <= k


def evaluate(
    golden: list[dict],
    ranked: list[dict],
    pool: dict[str, dict],
    ks: tuple[int, ...] = DEFAULT_KS,
) -> dict:
    """Classify each golden application against the ranked pool.

    golden: [{job_url, title, company, status, created_at}]
    ranked: [{job_url, similarity}] deduped, best-first ($vectorSearch order)
    pool:   {job_url: {embedded: bool, triaged_out: bool}} for the golden URLs
            that exist in discovered_jobs
    """
    rank_by_url: dict[str, int] = {}
    sim_by_url: dict[str, float | None] = {}
    facets_by_url: dict[str, dict] = {}
    for i, hit in enumerate(ranked):
        url = hit.get("job_url") or ""
        if url and url not in rank_by_url:
            rank_by_url[url] = i + 1
            sim_by_url[url] = hit.get("similarity")
            facets_by_url[url] = hit.get("facet_ranks") or {}

    results = []
    for app in golden:
        url = app.get("job_url") or ""
        entry = dict(app)
        if url in rank_by_url:
            entry["bucket"] = "ranked"
            entry["rank"] = rank_by_url[url]
            entry["similarity"] = sim_by_url[url]
            entry["facet_ranks"] = facets_by_url[url]
        elif url in pool:
            if pool[url].get("embedded"):
                # Embedded but past the ranked window (pool > MAX_VECTOR_LIMIT).
                entry["bucket"] = "beyond_window"
            else:
                entry["bucket"] = "not_embedded"
                entry["triaged_out"] = bool(pool[url].get("triaged_out"))
        else:
            entry["bucket"] = "not_in_pool"
        results.append(entry)

    # Recall is computed over the measurable subset only: golden jobs that are
    # in the pool with an embedding. TTL'd / never-scraped / never-embedded
    # jobs say nothing about vector-ranking quality.
    measurable = [r for r in results if r["bucket"] in ("ranked", "beyond_window")]
    recall = {
        k: (sum(1 for r in measurable if _hit(r, k)) / len(measurable))
        if measurable else None
        for k in ks
    }
    return {"results": results, "recall": recall, "measurable": len(measurable)}


def format_report(
    evaluation: dict,
    pool_count: int,
    query_source: str = "profile",
    facet_names: list[str] | None = None,
) -> str:
    results = evaluation["results"]
    recall = evaluation["recall"]
    measurable = evaluation["measurable"]

    def job_line(r: dict) -> str:
        created = r.get("created_at")
        when = f", saved {created.date().isoformat()}" if created else ""
        return f"{r.get('title') or '?'} — {r.get('company') or '?'} [{r.get('status') or '?'}{when}]"

    if query_source == "hyde":
        query_desc = f"HyDE ideal-posting facets: {', '.join(facet_names or [])}"
    else:
        query_desc = "raw profile (HyDE fallback)"
    lines = [
        f"Golden-set retrieval recall — {len(results)} tracker application(s) with a job URL",
        f"Pool: {pool_count} embedded job(s) in discovered_jobs (unfiltered — no date/location/level filters)",
        f"Query: {query_desc}",
        "",
    ]

    if measurable:
        recall_bits = []
        for k, v in recall.items():
            hits = sum(1 for r in results if _hit(r, k))
            recall_bits.append(f"Recall@{k}: {hits}/{measurable} ({v:.0%})")
        lines.append("   ".join(recall_bits))
        ranks = sorted(r["rank"] for r in results if r["bucket"] == "ranked")
        if ranks:
            lines.append(f"Median rank: {statistics.median(ranks):g}   Worst rank: {ranks[-1]}")
    else:
        lines.append("No measurable golden jobs — every application is out of the "
                     "current pool (TTL'd out, never scraped, or never embedded).")
    lines.append("")

    ranked = sorted((r for r in results if r["bucket"] == "ranked"), key=lambda r: r["rank"])
    if ranked:
        lines.append("RANKED (fused position in vector space today):")
        for r in ranked:
            sim = f"{r['similarity']:.3f}" if r.get("similarity") is not None else "  ?  "
            facet_ranks = r.get("facet_ranks") or {}
            per_facet = (
                "  [" + ", ".join(f"{n} #{fr}" for n, fr in facet_ranks.items()) + "]"
                if len(facet_ranks) > 0 and facet_names and len(facet_names) > 1 else ""
            )
            lines.append(f"  rank {r['rank']:>4}  sim {sim}  {job_line(r)}{per_facet}")
        lines.append("")

    beyond = [r for r in results if r["bucket"] == "beyond_window"]
    if beyond:
        lines.append(f"BEYOND RANKED WINDOW (pool exceeds {MAX_VECTOR_LIMIT}; embedded but unranked):")
        lines.extend(f"  {job_line(r)}" for r in beyond)
        lines.append("")

    not_embedded = [r for r in results if r["bucket"] == "not_embedded"]
    if not_embedded:
        lines.append("NOT EMBEDDED (in the pool but invisible to search):")
        for r in not_embedded:
            why = "triaged out" if r.get("triaged_out") else "embedding missing/failed"
            lines.append(f"  ({why}) {job_line(r)}")
        lines.append("")

    not_in_pool = [r for r in results if r["bucket"] == "not_in_pool"]
    if not_in_pool:
        lines.append("NOT IN POOL (aged out by the 45-day TTL, or never scraped — e.g. manual/pasted jobs):")
        lines.extend(f"  {job_line(r)}" for r in not_in_pool)
        lines.append("")

    lines.append("Note: real searches rank within a days_back window (smaller pool), so "
                 "at-search-time ranks were likely equal or better than the pool-wide ranks above.")
    return "\n".join(lines)


async def run_eval(
    db: AsyncIOMotorDatabase,
    settings: Settings,
    ks: tuple[int, ...] = DEFAULT_KS,
    tracker_db: str | None = None,
) -> str:
    """Load the golden set, rank the pool, and return the formatted report."""
    # Applications live in the API's tracker DB — same name as the scraper DB
    # under default config; --tracker-db overrides when they differ.
    tracker = db.client[tracker_db] if tracker_db else db
    apps = await (
        tracker.applications
        .find(
            {"JobUrl": {"$nin": [None, ""]}},
            {"_id": 0, "JobUrl": 1, "JobTitle": 1, "Company": 1, "Status": 1, "CreatedAt": 1},
        )
        .sort("CreatedAt", -1)
        .to_list(1000)
    )
    golden = [
        {
            "job_url": a["JobUrl"],
            "title": a.get("JobTitle"),
            "company": a.get("Company"),
            "status": a.get("Status"),
            "created_at": a.get("CreatedAt"),
        }
        for a in apps
    ]
    if not golden:
        return "No tracker applications with a job URL — nothing to evaluate."
    logger.info("Golden set: %d application(s)", len(golden))

    # Pool membership for the golden URLs. $slice:1 keeps the projection cheap
    # while still telling us whether an embedding exists; a URL rediscovered
    # across runs counts as embedded if ANY copy is.
    pool: dict[str, dict] = {}
    pool_docs = await db.discovered_jobs.find(
        {"job_url": {"$in": [g["job_url"] for g in golden]}},
        {"_id": 0, "job_url": 1, "triaged_out": 1, "job_embedding": {"$slice": 1}},
    ).to_list(MAX_VECTOR_LIMIT)
    for d in pool_docs:
        info = pool.setdefault(d["job_url"], {"embedded": False, "triaged_out": False})
        info["embedded"] = info["embedded"] or bool(d.get("job_embedding"))
        info["triaged_out"] = info["triaged_out"] or bool(d.get("triaged_out"))

    pool_count = await db.discovered_jobs.count_documents({"job_embedding": {"$type": "array"}})
    if pool_count == 0:
        return "The pool has no embedded jobs — run discovery first."

    # Same query facets + embedding + fusion path as production /api/search
    # (HyDE with raw-profile fallback), so the eval measures what search does.
    queries, query_source = await search.get_search_queries(settings)
    if not queries:
        raise RuntimeError(
            f"Profile unavailable — is the API running at {settings.api_base_url}?")
    facet_names = [q["name"] for q in queries]
    logger.info("Eval query source: %s (%s)", query_source, ", ".join(facet_names))
    vectors = await embeddings.embed_texts(settings, [q["text"] for q in queries])
    if any(v is None for v in vectors):
        raise RuntimeError("Failed to embed the search queries — check OPENAI_API_KEY")

    logger.info("Ranking pool of %d embedded job(s) per facet", pool_count)
    rankings: list[tuple[str, list[dict]]] = []
    for q, vector in zip(queries, vectors):
        pipeline = [
            {"$vectorSearch": {
                "index": search.VECTOR_INDEX_NAME,
                "path": "job_embedding",
                "queryVector": vector,
                "numCandidates": MAX_VECTOR_LIMIT,
                "limit": min(pool_count, MAX_VECTOR_LIMIT),
            }},
            {"$addFields": {"similarity": {"$meta": "vectorSearchScore"}}},
            {"$project": {"_id": 0, "id": 1, "job_url": 1, "similarity": 1}},
        ]
        try:
            hits = await db.discovered_jobs.aggregate(pipeline).to_list(MAX_VECTOR_LIMIT)
        except Exception as e:
            raise RuntimeError(
                f"$vectorSearch failed — is the Atlas index '{search.VECTOR_INDEX_NAME}' "
                f"created and Active? ({e})"
            ) from e
        rankings.append((q["name"], hits))
    ranked = search.fuse_rankings(rankings)

    return format_report(evaluate(golden, ranked, pool, ks), pool_count, query_source, facet_names)
