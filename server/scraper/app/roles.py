"""The shared pool's role list, loaded from a config file rather than code.

A new role should be a one-line edit plus a redeploy of the file, not a code
change — Step 6 (role growth from a new user's CV) writes to this same shape.
Nothing here depends on any user: the pool is common to everyone.
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "roles.json"


@dataclass(frozen=True)
class RolesConfig:
    roles: list[str]
    locations: list[str] = field(default_factory=lambda: ["Israel"])
    site_names: list[str] = field(default_factory=lambda: ["linkedin"])
    results_wanted: int = 50
    hours_old: int = 72
    country: str = "Israel"
    # A listing absent from this many consecutive runs is marked inactive.
    # Not 1: a single scrape missing a job is routine (rate limiting, a flaky
    # detail fetch, a board reshuffling its result page), and flipping a live
    # posting to inactive on one bad run is worse than noticing a day late.
    missed_runs_before_inactive: int = 3


def load(path: str | None = None) -> RolesConfig:
    """Read and validate the role config. Raises rather than falling back to a
    hardcoded list: a daily run against a silently-defaulted role set would
    quietly ingest the wrong pool for as long as nobody noticed."""
    config_path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not config_path.is_file():
        raise FileNotFoundError(
            f"Roles config not found at {config_path}. Set ROLES_CONFIG_PATH or restore the file."
        )

    raw = json.loads(config_path.read_text(encoding="utf-8"))
    roles = [r.strip() for r in raw.get("roles", []) if isinstance(r, str) and r.strip()]
    if not roles:
        raise ValueError(f"Roles config at {config_path} lists no roles.")

    # De-dupe case-insensitively but keep the file's own casing and order, so
    # the searches run in the order a human wrote them.
    seen: set[str] = set()
    unique_roles = []
    for r in roles:
        if r.casefold() in seen:
            logger.warning("Roles config lists %r more than once; ignoring the duplicate", r)
            continue
        seen.add(r.casefold())
        unique_roles.append(r)

    config = RolesConfig(
        roles=unique_roles,
        locations=[l for l in raw.get("locations", ["Israel"]) if isinstance(l, str) and l.strip()] or ["Israel"],
        site_names=raw.get("site_names") or ["linkedin"],
        results_wanted=int(raw.get("results_wanted", 50)),
        hours_old=int(raw.get("hours_old", 72)),
        country=raw.get("country", "Israel"),
        missed_runs_before_inactive=int(raw.get("missed_runs_before_inactive", 3)),
    )
    if config.missed_runs_before_inactive < 1:
        raise ValueError("missed_runs_before_inactive must be at least 1.")
    return config

