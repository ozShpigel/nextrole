import logging
import random
import time

from jobspy import scrape_jobs

from app.models.search_criteria import SearchCriteria

logger = logging.getLogger(__name__)

# Human-ish gap between consecutive job-board searches. LinkedIn rate-limits
# tight bursts from a single IP (soft block: 429s / empty pages for hours);
# the same volume spread over minutes stays under the radar. The nightly cron
# doesn't care that the run is slower.
PACING_SECONDS = (8.0, 20.0)


def scrape_for_criteria(criteria: SearchCriteria) -> tuple[list[dict], dict]:
    """Scrape jobs from configured sites for every (job title × location) pair.

    Dedups across pairs via job_url so the same listing appearing in two
    neighboring-city searches (e.g. Tel Aviv and Ramat Gan) is counted once.

    Returns (jobs, search_stats) — the stats make throttling visible: jobspy
    swallows rate-limit errors and just returns fewer rows, so a blocked run
    would otherwise look like a quiet job market.
    """
    all_jobs = []
    seen_urls = set()
    stats = {"searches_total": 0, "searches_failed": 0, "searches_empty": 0}

    locations = criteria.locations or [None]

    for title in criteria.job_titles:
        for loc in locations:
            if stats["searches_total"] > 0:
                pause = random.uniform(*PACING_SECONDS)
                logger.info("Pacing %.0fs before next search", pause)
                time.sleep(pause)
            stats["searches_total"] += 1

            where = loc or "any location"
            logger.info("Scraping '%s' @ %s from %s", title, where, criteria.site_names)
            try:
                scrape_kwargs = dict(
                    site_name=criteria.site_names,
                    search_term=title,
                    location=loc,
                    results_wanted=criteria.results_wanted,
                    hours_old=criteria.hours_old,
                    country_indeed=criteria.country,
                    linkedin_fetch_description=True,
                )
                if criteria.is_remote is not None:
                    scrape_kwargs["is_remote"] = criteria.is_remote

                df = scrape_jobs(**scrape_kwargs)
                if len(df) == 0:
                    stats["searches_empty"] += 1

                new_count = 0
                for _, row in df.iterrows():
                    url = str(row.get("job_url", "")) or ""
                    if url and url in seen_urls:
                        continue
                    if url:
                        seen_urls.add(url)

                    all_jobs.append({
                        "title": str(row.get("title", "")),
                        "company": str(row.get("company", "")),
                        "location": str(row.get("location", "")),
                        "description": str(row.get("description", "")),
                        "job_url": url,
                        "date_posted": str(row.get("date_posted", "")) if row.get("date_posted") else None,
                        "site": str(row.get("site", "linkedin")),
                        "job_level": str(row.get("job_level")) if row.get("job_level") else None,
                        "is_remote": bool(row.get("is_remote")) if row.get("is_remote") is not None else None,
                    })
                    new_count += 1

                logger.info("Found %d jobs for '%s' @ %s (%d new)", len(df), title, where, new_count)
            except Exception as e:
                stats["searches_failed"] += 1
                logger.error("Scraping failed for '%s' @ %s: %s", title, where, e)

    logger.info(
        "Total unique jobs scraped: %d (%d searches, %d failed, %d empty)",
        len(all_jobs), stats["searches_total"], stats["searches_failed"], stats["searches_empty"],
    )
    return all_jobs, stats
