import logging

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)


TTL_INDEX_NAME = "ttl_discovered_at_45d"
TTL_SECONDS = 60 * 24 * 3600  # 60 days


async def ensure_ttl_index(db: AsyncIOMotorDatabase) -> None:
    """Retention: purge discovered jobs after 60 days so the M0 tier (512MB)
    never fills up. Safe — jobs saved to the tracker are full copies in the
    tracker DB. Idempotent; called from both the web service startup and the
    CLI, so a cron-only deploy keeps retention too.

    Bumped from 45 (was: RAG-era docs carried a ~12KB embedding vector on top
    of ~6-8KB of other fields). Removing it frees real headroom, but this
    isn't a full 65% shrink — per-job scoring reintroduces its own weight
    (match_analysis, both Claude call snapshots). 60 is a modest bump, not a
    re-measured number; revisit once real scored-doc sizes are known.

    Changing a TTL index's expiry via create_index() with the same name
    conflicts (IndexOptionsConflict) once the old value is already live in
    Mongo — collMod is the documented way to update expireAfterSeconds on an
    existing index in place. Keeps the original index name (pre-dating the
    RAG removal) so this updates the real production index rather than
    trying to add a second, conflicting one on the same field.
    """
    try:
        await db.command({
            "collMod": "discovered_jobs",
            "index": {"name": TTL_INDEX_NAME, "expireAfterSeconds": TTL_SECONDS},
        })
    except Exception:
        # Index doesn't exist yet (fresh DB) — collMod has nothing to modify.
        try:
            await db.discovered_jobs.create_index(
                "discovered_at",
                expireAfterSeconds=TTL_SECONDS,
                name=TTL_INDEX_NAME,
            )
        except Exception as e:
            logger.warning("TTL index ensure failed (continuing): %s", e)


USER_ID_INDEX_NAME = "idx_user_id"


async def ensure_user_scope(db: AsyncIOMotorDatabase, legacy_owner_user_id: str) -> None:
    """Give every search criteria an owner, and index the field every criteria
    query now filters on.

    Criteria written before multi-user have no `user_id` and would otherwise
    belong to nobody. They are stamped with the legacy owner — this instance's
    own single user when it has one, otherwise a well-known id nothing reads.
    Nothing is deleted. Idempotent; a second run finds nothing to stamp.

    discovered_jobs / discovery_runs are deliberately absent: the job pool is
    shared across users by design, so there is nothing to scope there.
    """
    try:
        result = await db.search_criteria.update_many(
            {"user_id": {"$exists": False}},
            {"$set": {"user_id": legacy_owner_user_id}},
        )
        if result.modified_count:
            logger.warning(
                "User-scope migration: stamped %d unowned search criteria with user %s",
                result.modified_count, legacy_owner_user_id,
            )
        await db.search_criteria.create_index("user_id", name=USER_ID_INDEX_NAME)
    except Exception as e:
        logger.warning("search_criteria user scope ensure failed (continuing): %s", e)
