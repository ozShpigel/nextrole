import asyncio
import logging
import re
from html import unescape
from urllib.parse import quote_plus, unquote

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 10.0
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}

_RATING_SLASH_RE = re.compile(r"(\d\.\d)\s*/\s*5")
_RATING_STARS_RE = re.compile(r"(\d\.\d)\s*(?:out of|stars?)", re.IGNORECASE)
_REVIEW_TITLE_RE = re.compile(r"Reviews?\s*\(([\d,]+)\)")
_GD_URL_RE = re.compile(r"uddg=([^&\"]+glassdoor\.com[^&\"]+(?:Reviews|Overview)[^&\"]*)")


async def _search_ddg(query: str) -> str | None:
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True)
            resp.raise_for_status()
            return resp.text
    except Exception as e:
        logger.debug("DuckDuckGo search failed for '%s': %s", query, e)
        return None


def _parse_rating(html: str) -> dict | None:
    text = re.sub(r"<[^>]+>", " ", html)
    text = unescape(text)

    rating = None
    m = _RATING_SLASH_RE.search(text)
    if m:
        rating = float(m.group(1))
    if rating is None:
        m = _RATING_STARS_RE.search(text)
        if m:
            rating = float(m.group(1))

    if rating is None or not (1.0 <= rating <= 5.0):
        return None

    result: dict = {"rating": rating}

    m = _REVIEW_TITLE_RE.search(text)
    if m:
        result["reviewCount"] = int(m.group(1).replace(",", ""))

    m = _GD_URL_RE.search(html)
    if m:
        result["url"] = unquote(m.group(1)).split("&")[0]

    return result


async def fetch_glassdoor_rating(company: str, cache: dict[str, dict | None] | None = None) -> dict | None:
    if not company or not company.strip():
        return None

    key = company.strip().lower()
    if cache is not None and key in cache:
        return cache[key]

    html = await _search_ddg(f"{company.strip()} glassdoor overall rating")
    result = _parse_rating(html) if html else None

    # Relaxed retry with simpler query
    if result is None:
        html = await _search_ddg(f"{company.strip()} glassdoor reviews")
        result = _parse_rating(html) if html else None

    if cache is not None:
        cache[key] = result

    if result:
        logger.info("Glassdoor rating for '%s': %.1f (%s reviews)",
                     company, result["rating"], result.get("reviewCount", "?"))
    else:
        logger.debug("No Glassdoor rating found for '%s'", company)

    return result


async def prefetch_glassdoor_ratings(companies: list[str]) -> dict[str, dict | None]:
    cache: dict[str, dict | None] = {}
    unique = list({c.strip().lower(): c for c in companies if c and c.strip()}.values())

    if not unique:
        return cache

    logger.info("Prefetching Glassdoor ratings for %d unique companies", len(unique))
    tasks = [fetch_glassdoor_rating(c, cache) for c in unique]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    failed = sum(1 for r in results if isinstance(r, Exception))
    if failed:
        logger.warning("Glassdoor prefetch: %d/%d fetches raised exceptions", failed, len(results))
    found = sum(1 for v in cache.values() if v is not None)
    logger.info("Glassdoor prefetch complete: %d companies, %d with ratings", len(unique), found)

    return cache
