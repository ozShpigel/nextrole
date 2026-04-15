from pydantic import BaseModel


class CreateCriteriaRequest(BaseModel):
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


class UpdateCriteriaRequest(BaseModel):
    name: str | None = None
    job_titles: list[str] | None = None
    locations: list[str] | None = None
    site_names: list[str] | None = None
    results_wanted: int | None = None
    hours_old: int | None = None
    country: str | None = None
    is_remote: bool | None = None
    min_score_to_save: int | None = None
    values: list[str] | None = None
    preferences: str | None = None
    is_active: bool | None = None


class UpdateProfileRequest(BaseModel):
    content: str
