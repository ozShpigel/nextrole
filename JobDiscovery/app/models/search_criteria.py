from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class SearchCriteria(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    job_titles: list[str]
    locations: list[str] = []
    site_names: list[str] = ["linkedin"]
    results_wanted: int = 15
    hours_old: int = 72
    country: str = "Israel"
    is_remote: bool | None = None
    min_score_to_save: int = 55
    values: list[str] = []
    preferences: str = ""
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
