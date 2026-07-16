from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """Filters for the on-demand semantic job search."""
    limit: int = Field(default=10, ge=1, le=15)
    # Filters on discovered_at (collection date), not the board's posting date
    # (date_posted is an unreliable free-text string). With 24-48h ingest
    # windows, collected ~= posted within a day or two.
    days_back: int = Field(default=3, ge=1, le=45)
    # Free-text substring match applied AFTER $vectorSearch (jobspy locations
    # are free text; Atlas vector filters are equality/range only).
    location: str | None = None
    is_remote: bool | None = None
    # Exact-match against jobspy job_level (LinkedIn-populated; jobs from other
    # boards have null job_level and are excluded when this filter is set).
    job_levels: list[str] | None = None
    sites: list[str] | None = None
    # Focus the search on ONE HyDE facet by name (e.g. "backend-dotnet") instead
    # of fusing all facets. None = fused search across every facet (default).
    facet: str | None = None
