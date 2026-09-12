"""The shared pool's role list, loaded from a config file rather than code.

A new role should be a one-line edit plus a redeploy of the file, not a code
change — Step 6 (role growth from a new user's CV) writes to this same shape.
Nothing here depends on any user: the pool is common to everyone.
"""

import json
import logging
from datetime import datetime, timezone
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
    # Ceiling on how many roles the daily run searches, baseline included.
    # Every role is titles x locations more scraping, so one unusual CV must
    # not be able to grow the run without limit. Baseline roles are never the
    # ones dropped: they are human-authored and outrank user-grown roles.
    max_roles: int = 12


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
        max_roles=int(raw.get("max_roles", 12)),
    )
    if config.missed_runs_before_inactive < 1:
        raise ValueError("missed_runs_before_inactive must be at least 1.")
    if config.max_roles < len(config.roles):
        raise ValueError(
            f"max_roles ({config.max_roles}) is below the {len(config.roles)} baseline role(s) in "
            f"{config_path}. The baseline is never dropped, so a cap under it could never be honoured."
        )
    return config


async def effective_roles(db, config: RolesConfig) -> list[str]:
    """The roles this run will actually search: the config baseline, plus the
    roles users have grown the pool with, capped.

    Two halves on purpose. The baseline lives in a file because it is a human
    decision that should survive every deploy and every user coming and going.
    The grown half lives in Mongo because the app writes it — a file the app
    edits would be lost on the next container restart and would diverge between
    replicas. `pool_roles` is written by the API when a profile is saved (see
    PoolRoleService); nothing here decides who needs what.

    The cap is applied here rather than at write time because this is where the
    cost is: a role is titles x locations of extra scraping per day. Baseline
    roles are never cut. Grown roles compete for whatever is left, most-needed
    first, then oldest — so the cap behaves like a queue rather than a race, and
    a role that many users need is not displaced by one that arrived later.
    """
    baseline = list(config.roles)
    seen = {r.casefold() for r in baseline}
    room = config.max_roles - len(baseline)

    try:
        grown = await db.pool_roles.find({"Baseline": {"$ne": True}}).to_list(None)
    except Exception as e:
        # The baseline alone is a correct, useful run. Refusing to scrape at all
        # because the grown half is unreadable would be the worse failure.
        logger.error("Could not read pool_roles; running the baseline roles only: %s", e)
        return baseline

    grown.sort(key=lambda r: (-len(r.get("UserIds") or []), r.get("CreatedAt") or ""))

    admitted, refused = [], []
    for doc in grown:
        role = (doc.get("Role") or "").strip()
        if not role or role.casefold() in seen:
            continue
        seen.add(role.casefold())
        (admitted if len(admitted) < room else refused).append(role)

    if refused:
        logger.warning(
            "Role cap reached (max_roles=%d): searching %d user-grown role(s), holding back %d — %s. "
            "Raise max_roles in the roles config if the pool should cover them.",
            config.max_roles, len(admitted), len(refused), ", ".join(refused),
        )
    if admitted:
        logger.info("Daily run roles: %d baseline + %d user-grown", len(baseline), len(admitted))
    return baseline + admitted


async def publish_baseline(db, config: RolesConfig) -> None:
    """Mirror the config file's baseline roles into `pool_roles`.

    The API classifies a new CV against "roles already being searched", and it
    reads that list from `pool_roles` — it has no access to this file (separate
    service, separate image). Without the baseline in there, a backend engineer
    would be classified against an empty list and could be filed under an
    invented "Backend Developer" while "Backend Engineer" was already running:
    exactly the fragmentation the cap makes expensive.

    These rows are marked `Baseline` so user churn can never delete them, and
    they carry no user ids. The file stays authoritative for what actually gets
    searched (effective_roles reads it directly), so an edit takes effect on the
    next run whether or not this mirror is up to date.
    """
    try:
        keys = [r.casefold() for r in config.roles]
        for role, key in zip(config.roles, keys):
            await db.pool_roles.update_one(
                {"_id": key},
                {"$set": {"Role": role, "Baseline": True, "UpdatedAt": datetime.now(timezone.utc)},
                 "$setOnInsert": {"UserIds": [], "CreatedAt": datetime.now(timezone.utc)}},
                upsert=True,
            )
        # A role removed from the file stops being baseline. It is not deleted:
        # users may still be filed under it, and that is what decides whether it
        # keeps being searched.
        await db.pool_roles.update_many(
            {"Baseline": True, "_id": {"$nin": keys}}, {"$unset": {"Baseline": ""}}
        )
        stale = await db.pool_roles.delete_many({"Baseline": {"$exists": False}, "UserIds": []})
        if stale.deleted_count:
            logger.info("Dropped %d role(s) no longer baseline and needed by nobody", stale.deleted_count)
    except Exception as e:
        logger.error("Could not publish baseline roles to pool_roles: %s", e)
