from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env"}
    mongodb_connection_string: str = ""
    mongodb_database_name: str = "job-tracker"
    api_base_url: str = "http://localhost:5002"
    # OpenAI key for job/profile embeddings (text-embedding-3-small).
    # Empty = embedding calls fail per-chunk and jobs are stored without
    # embeddings (invisible to semantic search).
    openai_api_key: str = ""
    scoring_delay_seconds: float = 2.0
    # Reserved: shared secret for cron-triggered endpoints (the batch-cycle
    # cron was retired with the RAG migration; kept so existing deploys with
    # CRON_SECRET set don't need an env change).
    cron_secret: str = ""
    # Comma-separated list of allowed browser origins (frontend URLs).
    # "*" = allow any origin — fine for dev; prefer explicit list in prod.
    cors_origins: str = "*"
    # Public demo instance: block all writes (criteria/run/job mutations) so
    # visitors can't pollute shared data. Off = private instance, full read/write.
    demo_mode: bool = False

    def parsed_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
