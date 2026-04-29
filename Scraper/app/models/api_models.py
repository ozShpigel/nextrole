from pydantic import BaseModel, Field


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
