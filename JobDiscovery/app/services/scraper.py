import logging
from jobspy import scrape_jobs

from app.models.search_criteria import SearchCriteria

logger = logging.getLogger(__name__)


def scrape_for_criteria(criteria: SearchCriteria) -> list[dict]:
    """Scrape jobs from configured sites for all job titles in criteria."""
    all_jobs = []
    seen_urls = set()

    for title in criteria.job_titles:
        logger.info("Scraping '%s' from %s", title, criteria.site_names)
        try:
            scrape_kwargs = dict(
                site_name=criteria.site_names,
                search_term=title,
                location=criteria.locations[0] if criteria.locations else None,
                results_wanted=criteria.results_wanted,
                hours_old=criteria.hours_old,
                country_indeed=criteria.country,
                linkedin_fetch_description=True,
            )
            if criteria.is_remote is not None:
                scrape_kwargs["is_remote"] = criteria.is_remote

            df = scrape_jobs(**scrape_kwargs)

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

            logger.info("Found %d jobs for '%s'", len(df), title)
        except Exception as e:
            logger.error("Scraping failed for '%s': %s", title, e)

    logger.info("Total unique jobs scraped: %d", len(all_jobs))
    return all_jobs
