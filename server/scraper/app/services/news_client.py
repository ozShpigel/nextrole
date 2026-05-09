import asyncio
import logging
from html import unescape
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

_GOOGLE_NEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=en&gl=US&ceid=US:en"
_TIMEOUT = 10.0
_MAX_ITEMS = 10


async def _fetch_rss(query: str) -> list[dict]:
    url = _GOOGLE_NEWS_RSS.format(query=query)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=_TIMEOUT, follow_redirects=True)
            resp.raise_for_status()
    except Exception as e:
        logger.debug("News RSS fetch failed for query '%s': %s", query, e)
        return []

    try:
        root = ElementTree.fromstring(resp.text)
    except ElementTree.ParseError as e:
        logger.debug("News RSS parse failed for query '%s': %s", query, e)
        return []

    items = []
    for item in root.iter("item"):
        if len(items) >= _MAX_ITEMS:
            break
        title_el = item.find("title")
        source_el = item.find("source")
        pub_el = item.find("pubDate")
        if title_el is None or not (title_el.text or "").strip():
            continue
        items.append({
            "title": unescape(title_el.text.strip()),
            "source": source_el.text.strip() if source_el is not None and source_el.text else None,
            "published": pub_el.text.strip() if pub_el is not None and pub_el.text else None,
        })
    return items


async def fetch_company_news(company: str, cache: dict[str, list[dict]] | None = None) -> list[dict]:
    if not company or not company.strip():
        return []

    key = company.strip().lower()
    if cache is not None and key in cache:
        return cache[key]

    # Strict query first (quoted company name)
    items = await _fetch_rss(f'"{company.strip()}"')

    # Relaxed retry without quotes if strict returned nothing
    if not items:
        items = await _fetch_rss(company.strip())

    if cache is not None:
        cache[key] = items

    return items


async def prefetch_company_news(companies: list[str]) -> dict[str, list[dict]]:
    """Fetch news for all companies in parallel. Returns a populated cache dict."""
    cache: dict[str, list[dict]] = {}
    unique = list({c.strip().lower(): c for c in companies if c and c.strip()}.values())

    if not unique:
        return cache

    logger.info("Prefetching news for %d unique companies", len(unique))
    tasks = [fetch_company_news(c, cache) for c in unique]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    failed = sum(1 for r in results if isinstance(r, Exception))
    if failed:
        logger.warning("News prefetch: %d/%d fetches raised exceptions", failed, len(results))
    logger.info("News prefetch complete: %d companies, %d with results",
                len(unique), sum(1 for v in cache.values() if v))

    return cache
