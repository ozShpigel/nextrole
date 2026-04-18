from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_connection_string: str = ""
    mongodb_database_name: str = "job-tracker"
    application_tracker_base_url: str = "http://localhost:5002"
    job_match_service_url: str = "http://localhost:5136"
    scoring_delay_seconds: float = 2.0
