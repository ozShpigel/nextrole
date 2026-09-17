from pydantic import BaseModel


class ScrapeSpec(BaseModel):
    """What to ask jobspy for: the parameters of one scrape, nothing else.

    This was `SearchCriteria`, a user-owned document with an id, an owner, a
    name and a save threshold. The criteria-driven ingest that read those
    documents is gone (docs/scraper-slimming.md, Phase 0) and the only
    remaining caller builds one in memory from `config/roles.json`, so what
    survives is the seven fields `scrape_for_criteria` actually reads.

    Deliberately has no `user_id`. The pool is shared, and a scrape is not
    performed on anyone's behalf — keeping an owner field here is what let the
    two ideas blur together in the first place.
    """

    job_titles: list[str]
    locations: list[str] = []
    site_names: list[str] = ["linkedin"]
    results_wanted: int = 15
    hours_old: int = 72
    country: str = "Israel"
    is_remote: bool | None = None
