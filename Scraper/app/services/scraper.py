import logging
from jobspy import scrape_jobs

from app.models.search_criteria import SearchCriteria

logger = logging.getLogger(__name__)


def scrape_for_criteria(criteria: SearchCriteria) -> list[dict]:
    """Scrape jobs from configured sites for every (job title × location) pair.

    Dedups across pairs via job_url so the same listing appearing in two
    neighboring-city searches (e.g. Tel Aviv and Ramat Gan) is counted once.
    """
    all_jobs = []
    seen_urls = set()

    locations = criteria.locations or [None]

    for title in criteria.job_titles:
        for loc in locations:
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
                    })
                    new_count += 1

                logger.info("Found %d jobs for '%s' @ %s (%d new)", len(df), title, where, new_count)
            except Exception as e:
                logger.error("Scraping failed for '%s' @ %s: %s", title, where, e)

    logger.info("Total unique jobs scraped: %d", len(all_jobs))
    return all_jobs
