import logging
import random
import re
import time
from uuid import uuid4

import pandas as pd
from jobspy import scrape_jobs

from app.models.search_criteria import SearchCriteria

logger = logging.getLogger(__name__)

# Scraped description text carries noise between words that read as adjacent
# to a human: markdown-escaping (backslash-escaped punctuation, stray "**"
# bold markers, blank lines — real Genpact text: "Remote Type \-**\n\nOffice")
# and digits (real Check Point text: "hybrid, 3 days a week from the office").
# `[\W_]` alone excludes digits (they're \w); `[^a-zA-Z]` bridges both.
_NOISE = r"[^a-zA-Z]{0,15}"

# "hybrid" alone is too broad — "hybrid environments"/"hybrid cloud"/"hybrid
# app" are common *technical* usages unrelated to work arrangement. Requiring
# one of these neighboring words scopes the match to the work-arrangement
# sense ("hybrid model", "hybrid work", "hybrid role", "3 days hybrid", …).
_HYBRID_WORK_ARRANGEMENT_RE = re.compile(
    rf"hybrid{_NOISE}(work|model|role|office|day)", re.IGNORECASE
)
# A posting's own structured field can explicitly self-declare non-remote
# (e.g. "Remote type - Office") — jobspy's substring match still fires on the
# word "remote" in the label and misses the "Office" value right after it.
_REMOTE_TYPE_OFFICE_RE = re.compile(rf"remote{_NOISE}type{_NOISE}office", re.IGNORECASE)
# "Mainly/primarily/mostly in-office, with flexible WFH when needed" — the
# stated PRIMARY arrangement is in-office; WFH/remote is an occasional
# exception, not the job's actual work location. Requires the qualifying
# adverb (not a bare "in-office" substring) so it doesn't false-negative a
# genuinely remote role that also mentions optional in-office days.
_PRIMARILY_OFFICE_RE = re.compile(
    rf"(mainly|primarily|mostly){_NOISE}(in{_NOISE}office|on{_NOISE}site|from{_NOISE}office)",
    re.IGNORECASE,
)


def _clean(value) -> str | None:
    """Stringify a scraped DataFrame cell, treating pandas NaN as missing.

    `row.get(field)` on a missing cell returns float NaN, not None — and NaN
    is truthy in Python, so a plain `if row.get(field)` guard stringifies it
    into the literal text "nan" instead of treating it as absent.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    return text or None


def _clean_bool(value) -> bool | None:
    """Same NaN trap as `_clean`, for a boolean cell.

    `bool(NaN)` is True, so a missing is_remote read through a plain
    `bool(...) if ... is not None` guard comes out as "remote" rather than
    "unknown" — NaN is not None.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return bool(value)


# Human-ish gap between consecutive job-board searches. LinkedIn rate-limits
# tight bursts from a single IP (soft block: 429s / empty pages for hours);
# the same volume spread over minutes stays under the radar. The nightly cron
# doesn't care that the run is slower.
PACING_SECONDS = (8.0, 20.0)


def _correct_is_remote(is_remote: bool | None, title: str, description: str) -> bool | None:
    """jobspy's own is_remote heuristic (jobspy/linkedin/util.py) does a naive
    substring match on ["remote", "work from home", "wfh"] across title +
    description + location, with no understanding of what the surrounding
    text actually says. Confirmed false-positive patterns on real data:

    1. A hybrid posting spells out its split ("Hybrid Work Model - 2 days
       WFH, 3 days in office") — "wfh" substring-matches with no literal
       "remote" mention at all.
    2. A hybrid posting describes its remote *portion* using the word
       "remote" itself ("nice-flex hybrid model... 2 office / 3 remote
       days") — the overall arrangement is hybrid, but a literal "remote"
       mention is also present, so pattern 1's check alone misses it. The
       fix: an explicit "hybrid work/model/role/..." phrase always wins,
       regardless of whether "remote" also appears elsewhere.
    3. The posting's own structured field explicitly self-declares non-remote
       ("Remote type - Office") — the label contains "remote", the value
       right after it says the opposite, and jobspy's substring match only
       sees the label.
    4. The posting states its PRIMARY arrangement is in-office, with WFH
       carved out as an occasional exception ("mainly in-office, with
       flexible work from home when needed") — "work from home" still
       substring-matches jobspy's keyword list regardless of the "mainly
       in-office" qualifier right before it.

    Deliberately narrow to work-arrangement phrasing (see
    _HYBRID_WORK_ARRANGEMENT_RE, _PRIMARILY_OFFICE_RE) rather than bare
    "hybrid"/"in-office" substrings, since "hybrid environments"/"hybrid
    cloud" are common unrelated technical usages, and "in-office" alone could
    describe optional in-office days for an otherwise genuinely remote role —
    both would otherwise false-*negative* a genuinely remote role.
    """
    if not is_remote:
        return is_remote
    text = f"{title} {description}"
    if _REMOTE_TYPE_OFFICE_RE.search(text):
        return False
    if _HYBRID_WORK_ARRANGEMENT_RE.search(text):
        return False
    if _PRIMARILY_OFFICE_RE.search(text):
        return False
    return is_remote


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
                    # EVERY cell read below goes through _clean/_clean_bool.
                    # jobspy builds one DataFrame per job, drops its all-NA
                    # columns, then concatenates them, so a field that some
                    # jobs in this batch have and others don't arrives as
                    # float NaN — not None. str(NaN) is the text "nan" and
                    # bool(NaN) is True, so a bare str()/bool() silently
                    # invents data. (A field *no* job in the batch has is
                    # re-added as None afterwards and reads correctly, which
                    # is why this only bites on partial failures — e.g. a
                    # LinkedIn detail fetch that times out for some rows.)
                    url = _clean(row.get("job_url")) or ""
                    if url and url in seen_urls:
                        continue
                    if url:
                        seen_urls.add(url)

                    company_profile = {
                        "industry": _clean(row.get("company_industry")),
                        "description": _clean(row.get("company_description")),
                        "numEmployees": _clean(row.get("company_num_employees")),
                        "revenue": _clean(row.get("company_revenue")),
                        "url": _clean(row.get("company_url")),
                    }
                    company_profile = {k: v for k, v in company_profile.items() if v} or None

                    title_text = _clean(row.get("title")) or ""
                    description_text = _clean(row.get("description")) or ""

                    # linkedin_fetch_description=True means one extra request
                    # per job, and jobspy returns {} for the ones that time out
                    # or get soft-blocked. Those jobs still get scored, so the
                    # Analyst/Evaluator are billed to read nothing — log it
                    # rather than let a throttled run look like a quiet one.
                    if not description_text:
                        logger.warning(
                            "Scraped job with no description: '%s' at '%s' (%s) — "
                            "it will be scored on title alone",
                            title_text, _clean(row.get("company")) or "", url or "no url",
                        )

                    all_jobs.append({
                        "id": str(uuid4()),
                        "title": title_text,
                        "company": _clean(row.get("company")) or "",
                        "location": _clean(row.get("location")) or "",
                        "description": description_text,
                        "job_url": url,
                        "date_posted": _clean(row.get("date_posted")),
                        "site": _clean(row.get("site")) or "linkedin",
                        "job_level": _clean(row.get("job_level")),
                        "is_remote": _correct_is_remote(
                            _clean_bool(row.get("is_remote")),
                            title_text,
                            description_text,
                        ),
                        "company_logo": _clean(row.get("company_logo")),
                        # Company profile fields jobspy already returns on every
                        # scrape (no extra HTTP call) — industry/size/description,
                        # kept as its own structured block (never fused into
                        # `description`) so it stays a distinct, labeled input to
                        # the Evaluator rather than polluting the parsed job text.
                        "company_profile": company_profile,
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


# Public LinkedIn job links come slugged — /jobs/view/senior-data-engineer-at-
# acme-4123456789 — as well as bare (/jobs/view/4123456789) and as a
# currentJobId= query param on a search page. The optional slug segment must be
# lazy and end in a hyphen so the trailing digit run is the job id, not the
# digits inside a slug like "web3-engineer".
_LINKEDIN_JOB_ID_RE = re.compile(r"(?:jobs/view/(?:[\w-]*?-)?|currentJobId=)(\d+)")


def fetch_job_by_url(url: str) -> dict | None:
    """Fetch a single LinkedIn posting directly by URL — for the "Import Job"
    button (a link found outside of discovery), not a search. Returns None
    on any failure (bad URL, blocked/expired link, page structure changed).

    jobspy's own per-result detail fetch (LinkedIn._get_job_details) returns
    description/company_logo/job_level but not title/company — it assumes
    the caller already has those from a search result card, which isn't true
    here. Both are parsed from the same job page's own top-card elements
    instead: an unofficial surface (LinkedIn's public page structure, not a
    documented API) but the same one jobspy's own selectors already depend
    on, so it's no more fragile than the rest of this scraping stack.
    """
    match = _LINKEDIN_JOB_ID_RE.search(url)
    if not match:
        return None
    job_id = match.group(1)

    from bs4 import BeautifulSoup
    from jobspy import LinkedIn
    from jobspy.model import ScraperInput, Site

    scraper = LinkedIn()
    scraper.scraper_input = ScraperInput(site_type=[Site.LINKEDIN])

    try:
        response = scraper.session.get(f"{scraper.base_url}/jobs/view/{job_id}", timeout=10)
        response.raise_for_status()
    except Exception as e:
        logger.warning("Import: failed to fetch LinkedIn job %s: %s", job_id, e)
        return None
    if "linkedin.com/signup" in response.url:
        logger.warning("Import: LinkedIn redirected job %s to signup (link blocked or expired)", job_id)
        return None

    soup = BeautifulSoup(response.text, "html.parser")
    title_tag = soup.find("h1", class_=lambda x: x and "top-card-layout__title" in x)
    org_tag = soup.find("a", class_=lambda x: x and "topcard__org-name-link" in x)
    loc_tag = soup.find("span", class_=lambda x: x and "topcard__flavor--bullet" in x)

    title = title_tag.get_text(strip=True) if title_tag else None
    company = org_tag.get_text(strip=True) if org_tag else None
    if not title or not company:
        logger.warning("Import: could not parse title/company for job %s", job_id)
        return None

    # Everything below is parsed from the page already fetched above. Calling
    # jobspy's _get_job_details(job_id) here would GET the same URL a second
    # time — doubling the LinkedIn hits per import on a surface this module
    # otherwise paces carefully — and it swallows every failure of that second
    # request by returning {}. A slow or throttled retry therefore produced a
    # job with an empty description that still looked like a successful import,
    # which import_jobs then scored and saved to the tracker at DecidedToApply.
    from jobspy.linkedin.util import parse_company_industry, parse_job_level
    from jobspy.model import DescriptionFormat
    from jobspy.util import markdown_converter, remove_attributes

    description = None
    div_content = soup.find("div", class_=lambda x: x and "show-more-less-html__markup" in x)
    if div_content is not None:
        description = remove_attributes(div_content).prettify(formatter="html")
        if scraper.scraper_input.description_format == DescriptionFormat.MARKDOWN:
            description = markdown_converter(description)
    description = _clean(description)
    if not description:
        # Better a visible import failure than a tracked application whose
        # description — the only thing the Evaluator actually reads — is empty.
        logger.warning("Import: no description found for job %s", job_id)
        return None

    logo_tag = soup.find("img", {"class": "artdeco-entity-image"})
    industry = _clean(parse_company_industry(soup))

    return {
        "title": title,
        "company": company,
        "location": loc_tag.get_text(strip=True) if loc_tag else "",
        "description": description,
        "job_url": f"{scraper.base_url}/jobs/view/{job_id}",
        "site": "linkedin",
        "job_level": _clean(parse_job_level(soup)),
        "is_remote": None,
        "company_logo": _clean(logo_tag.get("data-delayed-url")) if logo_tag else None,
        "company_profile": {"industry": industry} if industry else None,
    }
