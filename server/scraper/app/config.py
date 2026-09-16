from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # "ignore" (not the pydantic-settings default "forbid"): a removed field
    # left set in a real .env or a Render dashboard must not crash startup —
    # OPENAI_API_KEY (retired with RAG removal) is exactly this case.
    model_config = {"env_file": ".env", "extra": "ignore"}
    mongodb_connection_string: str = ""
    mongodb_database_name: str = "job-tracker"
    api_base_url: str = "http://localhost:5002"
    # Sent as X-Api-Key on every call to api_base_url — required when that API
    # has its own ApiKey gate set (see Program.cs). Empty = no header sent,
    # which is what nextrole.cloud and a local API both do -- they leave their
    # own ApiKey unset.
    api_key: str = ""
    scoring_delay_seconds: float = 2.0
    # Reserved: shared secret for cron-triggered endpoints (the batch-cycle
    # cron was retired with the RAG migration; kept so existing deploys with
    # CRON_SECRET set don't need an env change).
    cron_secret: str = ""
    # Comma-separated list of allowed browser origins (frontend URLs).
    # "*" = allow any origin — fine for dev; prefer explicit list in prod.
    cors_origins: str = "*"
    # Request identity (mirrors the API Identity section). "fixed" = single
    # user, id from identity_fixed_user_id; "cookie" = multi-user, id from the
    # uid cookie. Cookie mode needs explicit cors_origins, since a browser will
    # not send credentials to a wildcard origin.
    identity_mode: str = "fixed"
    identity_fixed_user_id: str = ""
    identity_cookie_name: str = "uid"
    # Cutover: honour a pre-sessions cookie (the bare userId) read-only, so a
    # visitor mid-migration is not orphaned. Mirrors the API's
    # IdentityOptions.AcceptLegacyGuidCookie and must be turned off in step
    # with it (docs/auth.md, Phase 1.5).
    accept_legacy_guid_cookie: bool = True
    # Path to the shared pool role list (app/../config/roles.json by default).
    roles_config_path: str = ""

    def parsed_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
