import asyncio
import logging
import random
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
_REVIEW_BASED_ON_RE = re.compile(r"based on\s+(?:over\s+)?([\d,]+)\s+(?:company\s+)?reviews", re.IGNORECASE)
_GD_URL_RE = re.compile(r"uddg=([^&\"]+glassdoor\.com[^&\"]+(?:Reviews|Overview)[^&\"]*)")

_SUB_RATING_RE = re.compile(
    r"(\d\.\d)\s*(?:out of 5\s*)?for\s+"
    r"(work.?life balance|culture (?:and|&) values|career opportunities|"
    r"senior management|compensation (?:and|&) benefits)",
    re.IGNORECASE,
)
_SUB_RATING_KEYS = {
    "work life balance": "workLifeBalance",
    "culture and values": "cultureAndValues",
    "career opportunities": "careerOpportunities",
    "senior management": "seniorManagement",
    "compensation and benefits": "compensationAndBenefits",
}
_RECOMMEND_RE = re.compile(r"(\d{1,3})\s*%\s*of[^.%]{0,80}?would recommend", re.IGNORECASE)
_SNIPPET_PHRASES = ("also rated", "would recommend")

# DDG politeness: the prefetch fans out over all companies at once and each
# company is now up to 3 queries — bound concurrency and jitter the requests.
_DDG_SEMAPHORE = asyncio.Semaphore(4)


async def _search_ddg(query: str) -> str | None:
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        async with _DDG_SEMAPHORE:
            await asyncio.sleep(random.uniform(0.1, 0.4))
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True)
                resp.raise_for_status()
                return resp.text
    except Exception as e:
        logger.debug("DuckDuckGo search failed for '%s': %s", query, e)
        return None


def _clean_text(html: str) -> str:
    # Collapse whitespace: DDG bolds query terms (<b>work</b> <b>life</b>),
    # so de-tagging leaves runs of spaces that break phrase regexes.
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html)))


def _parse_review_count(text: str) -> int | None:
    m = _REVIEW_TITLE_RE.search(text)
    if m is None:
        m = _REVIEW_BASED_ON_RE.search(text)
    return int(m.group(1).replace(",", "")) if m else None


def _parse_rating_text(text: str, html: str) -> dict | None:
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

    count = _parse_review_count(text)
    if count:
        result["reviewCount"] = count

    m = _GD_URL_RE.search(html)
    if m:
        result["url"] = unquote(m.group(1)).split("&")[0]

    return result


def _parse_rating(html: str) -> dict | None:
    return _parse_rating_text(_clean_text(html), html)


def _extract_snippets(text: str) -> list[str]:
    snippets: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        s = " ".join(sentence.split())[:300]
        low = s.lower()
        if any(p in low for p in _SNIPPET_PHRASES) and s not in snippets:
            snippets.append(s)
            if len(snippets) >= 2:
                break
    return snippets


def _parse_reviews(html: str) -> dict:
    text = _clean_text(html)
    result: dict = {}

    sub_ratings: dict[str, float] = {}
    for m in _SUB_RATING_RE.finditer(text):
        value = float(m.group(1))
        if not (1.0 <= value <= 5.0):
            continue
        category = " ".join(m.group(2).lower().replace("&", "and").replace("-", " ").split())
        key = _SUB_RATING_KEYS.get(category)
        if key and key not in sub_ratings:
            sub_ratings[key] = value
    if sub_ratings:
        result["subRatings"] = sub_ratings

    m = _RECOMMEND_RE.search(text)
    if m:
        pct = int(m.group(1))
        if 0 <= pct <= 100:
            result["recommendPercent"] = pct

    snippets = _extract_snippets(text)
    if snippets:
        result["snippets"] = snippets

    return result


async def fetch_glassdoor_rating(company: str, cache: dict[str, dict | None] | None = None) -> dict | None:
    if not company or not company.strip():
        return None

    key = company.strip().lower()
    if cache is not None and key in cache:
        return cache[key]

    name = company.strip()
    merged: dict = {}

    # Q1: deep employee-review aggregates (sub-ratings, recommend %, snippets)
    html = await _search_ddg(f"{name} glassdoor work life balance reviews")
    if html:
        merged.update(_parse_reviews(html))
        # Sub-rating sentences also match the overall-rating regexes
        # ("4.2 out of 5 for work life balance") — strip them before
        # extracting the overall rating from this page.
        stripped = _SUB_RATING_RE.sub(" ", _clean_text(html))
        overall = _parse_rating_text(stripped, html)
        if overall:
            merged.update(overall)
        else:
            count = _parse_review_count(stripped)
            if count:
                merged["reviewCount"] = count

    # Q2: overall rating, if Q1 didn't surface one
    if "rating" not in merged:
        html = await _search_ddg(f"{name} glassdoor overall rating")
        overall = _parse_rating(html) if html else None
        if overall:
            for k, v in overall.items():
                merged.setdefault(k, v)

    # Q3: relaxed retry with simpler query, only when nothing at all was found
    if not merged:
        html = await _search_ddg(f"{name} glassdoor reviews")
        overall = _parse_rating(html) if html else None
        if overall:
            merged.update(overall)

    result = merged or None

    if cache is not None:
        cache[key] = result

    if result:
        if "rating" in result:
            logger.info("Glassdoor rating for '%s': %.1f (%s reviews)",
                        company, result["rating"], result.get("reviewCount", "?"))
        else:
            logger.info("Glassdoor review data for '%s' (no overall rating): %s",
                        company, ", ".join(sorted(result.keys())))
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
