import asyncio
import logging
import random
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 10.0
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}

# Shared politeness gate across every DDG-backed enrichment client (Glassdoor
# ratings, company size). Each client used to keep its own separate
# semaphore, so running them concurrently doubled real concurrent load on
# DDG's html endpoint — a real discovery run measured this tripping DDG's
# rate limiting hard (202 "anomaly" pages escalating to 403s mid-run),
# leaving company-size at a 0% real-world hit rate. A single shared
# semaphore plus a minimum spacing between ANY two requests (not just
# per-slot jitter) caps actual requests/second regardless of how many
# clients fire at once.
_DDG_SEMAPHORE = asyncio.Semaphore(2)
_MIN_INTERVAL = 2.0  # seconds between any two DDG requests, globally
_pacing_lock = asyncio.Lock()
_last_request_at = 0.0


async def search_ddg(query: str) -> str | None:
    global _last_request_at
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        async with _DDG_SEMAPHORE:
            async with _pacing_lock:
                loop = asyncio.get_running_loop()
                wait = _last_request_at + _MIN_INTERVAL - loop.time()
                if wait > 0:
                    await asyncio.sleep(wait + random.uniform(0, 0.5))
                _last_request_at = loop.time()
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True)
                resp.raise_for_status()
                return resp.text
    except Exception as e:
        logger.debug("DuckDuckGo search failed for '%s': %s", query, e)
        return None
