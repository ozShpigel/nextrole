from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_connection_string: str = ""
    mongodb_database_name: str = "job-tracker"
    application_tracker_base_url: str = "http://localhost:5002"
    job_match_service_url: str = "http://localhost:5136"
    scoring_delay_seconds: float = 2.0
    # Comma-separated list of allowed browser origins (frontend URLs).
    # "*" = allow any origin — fine for dev; prefer explicit list in prod.
    cors_origins: str = "*"

    def parsed_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
