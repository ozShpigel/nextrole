from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env"}
    mongodb_connection_string: str = ""
    mongodb_database_name: str = "job-tracker"
    api_base_url: str = "http://localhost:5002"
    scoring_delay_seconds: float = 2.0
    # Shared secret guarding cron-triggered endpoints. Empty = no guard
    # (dev/local). In prod, set this and pass it as the X-Cron-Key header.
    cron_secret: str = ""
    # Comma-separated list of allowed browser origins (frontend URLs).
    # "*" = allow any origin — fine for dev; prefer explicit list in prod.
    cors_origins: str = "*"
    # Public demo instance: block all writes (criteria/run/job mutations) so
    # visitors can't pollute shared data. Off = private instance, full read/write.
    demo_mode: bool = False

    def parsed_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
