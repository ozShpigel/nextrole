from pydantic import BaseModel, Field, model_validator

# Each job_title × location pair is one job-board search per run. Cap the pair
# count so a single criteria can't burst-scrape LinkedIn (same IP, tight loop)
# into a rate-limit block. Mirrored client-side in CriteriaPanel.tsx.
MAX_SEARCHES_PER_RUN = 12


def search_pairs(job_titles: list[str], locations: list[str]) -> int:
    return len(job_titles) * max(1, len(locations))


def pairs_error(job_titles: list[str], locations: list[str]) -> str:
    return (
        f"{len(job_titles)} titles x {max(1, len(locations))} locations = "
        f"{search_pairs(job_titles, locations)} searches per run - "
        f"exceeds the limit of {MAX_SEARCHES_PER_RUN}. Split into separate criteria "
        f"or trim titles/locations."
    )


class CreateCriteriaRequest(BaseModel):
    name: str = Field(..., max_length=200)
    job_titles: list[str] = Field(..., max_length=20)
    locations: list[str] = Field(default=[], max_length=20)
    site_names: list[str] = Field(default=["linkedin"], max_length=5)
    results_wanted: int = Field(default=15, ge=1, le=100)
    hours_old: int = Field(default=72, ge=1, le=720)
    country: str = Field(default="Israel", max_length=100)
    is_remote: bool | None = None
    min_score_to_save: int = Field(default=70, ge=0, le=100)

    @model_validator(mode="after")
    def _cap_search_pairs(self):
        if search_pairs(self.job_titles, self.locations) > MAX_SEARCHES_PER_RUN:
            raise ValueError(pairs_error(self.job_titles, self.locations))
        return self


class UpdateCriteriaRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    job_titles: list[str] | None = Field(default=None, max_length=20)
    locations: list[str] | None = Field(default=None, max_length=20)
    site_names: list[str] | None = Field(default=None, max_length=5)
    results_wanted: int | None = Field(default=None, ge=1, le=100)
    hours_old: int | None = Field(default=None, ge=1, le=720)
    country: str | None = Field(default=None, max_length=100)
    is_remote: bool | None = None
    min_score_to_save: int | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None
