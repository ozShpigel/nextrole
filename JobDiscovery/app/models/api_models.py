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
    min_score_to_save: int = 70


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
    is_active: bool | None = None


class ScoringConfig(BaseModel):
    model: str = "claude-sonnet-4-6"
    temperature_match: float = 0.5
    temperature_discovery: float = 0.3
    max_tokens_match: int = 4096
    max_tokens_discovery: int = 1024
    thinking_enabled_discovery: bool = True
    thinking_budget_discovery: int = 1024


class UpdateProfileRequest(BaseModel):
    content: str | None = None
    scoring_config: ScoringConfig | None = None
