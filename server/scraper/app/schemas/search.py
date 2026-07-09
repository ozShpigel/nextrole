from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """Filters for the on-demand semantic job search."""
    limit: int = Field(default=10, ge=1, le=15)
    days_back: int = Field(default=14, ge=1, le=45)
    # Free-text substring match applied AFTER $vectorSearch (jobspy locations
    # are free text; Atlas vector filters are equality/range only).
    location: str | None = None
    is_remote: bool | None = None
    # Exact-match against jobspy job_level (LinkedIn-populated; jobs from other
    # boards have null job_level and are excluded when this filter is set).
    job_levels: list[str] | None = None
    sites: list[str] | None = None
