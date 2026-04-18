from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_connection_string: str = ""
    mongodb_database_name: str = "job-tracker"
    anthropic_api_key: str = ""
    application_tracker_base_url: str = "http://localhost:5002"
    claude_model: str = "claude-sonnet-4-6"
    scoring_delay_seconds: float = 2.0
    profile_path: str = "app/data/professional-profile.md"
