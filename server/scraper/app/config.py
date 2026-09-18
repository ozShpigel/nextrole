from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """What the jobspy adapter needs, which is almost nothing.

    Everything else went with docs/scraper-slimming.md: the Mongo connection,
    the API base URL and its key, the identity mode and the cookie name, the
    roles config path. This service holds no credential and knows about no
    database, no user and no role list.

    `extra: "ignore"` rather than the pydantic-settings default `"forbid"`: a
    removed field left set in a real .env must not crash startup, and this
    change removes eight of them at once. A deploy whose .env.scraper still
    carries MONGODB_CONNECTION_STRING starts cleanly and ignores it.
    """

    model_config = {"env_file": ".env", "extra": "ignore"}

    # Comma-separated allowed browser origins. Vestigial: the client does not
    # call this service any more (Phase 3a). Kept for a local dev setup that
    # points a browser straight at it.
    cors_origins: str = "*"

    def parsed_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
