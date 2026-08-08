import asyncio
import logging
import re
from html import unescape

from app.services.ddg_search import search_ddg as _search_ddg

logger = logging.getLogger(__name__)

_RANGE_RE = re.compile(r"([\d][\d,]{0,6})\s*(?:-|–|to)\s*([\d][\d,]{0,6})\s*employees", re.IGNORECASE)
_PLUS_RE = re.compile(r"([\d][\d,]{0,6})\s*\+\s*employees", re.IGNORECASE)
_FLAT_RE = re.compile(r"([\d][\d,]{0,6})\s*employees", re.IGNORECASE)


def _clean_text(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html)))


def _parse_employee_count(text: str) -> str | None:
    m = _RANGE_RE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)} employees"
    m = _PLUS_RE.search(text)
    if m:
        return f"{m.group(1)}+ employees"
    m = _FLAT_RE.search(text)
    if m:
        return f"{m.group(1)} employees"
    return None


async def fetch_company_size(company: str, cache: dict[str, str | None] | None = None) -> str | None:
    if not company or not company.strip():
        return None

    key = company.strip().lower()
    if cache is not None and key in cache:
        return cache[key]

    name = company.strip()
    result = None

    # Q1: LinkedIn-flavored query first — jobs are sourced from LinkedIn, so
    # its own company page is the most likely hit to surface a headcount.
    for query in (f"{name} linkedin employees", f"{name} number of employees", f"{name} company size"):
        html = await _search_ddg(query)
        if html:
            result = _parse_employee_count(_clean_text(html))
        if result:
            break

    if cache is not None:
        cache[key] = result

    if result:
        logger.info("Company size for '%s': %s", company, result)
    else:
        logger.debug("No company size found for '%s'", company)

    return result


async def prefetch_company_sizes(companies: list[str]) -> dict[str, str | None]:
    cache: dict[str, str | None] = {}
    unique = list({c.strip().lower(): c for c in companies if c and c.strip()}.values())

    if not unique:
        return cache

    logger.info("Prefetching company size for %d unique companies", len(unique))
    tasks = [fetch_company_size(c, cache) for c in unique]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    failed = sum(1 for r in results if isinstance(r, Exception))
    if failed:
        logger.warning("Company size prefetch: %d/%d fetches raised exceptions", failed, len(results))
    found = sum(1 for v in cache.values() if v is not None)
    logger.info("Company size prefetch complete: %d companies, %d with size found", len(unique), found)

    return cache
