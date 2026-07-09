import logging

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)


async def ensure_ttl_index(db: AsyncIOMotorDatabase) -> None:
    """Retention: purge discovered jobs after 45 days so the M0 tier (512MB)
    never fills up. Safe — jobs saved to the tracker are full copies in the
    tracker DB. Idempotent for an identical spec; called from both the web
    service startup and the CLI, so a cron-only deploy keeps retention too.
    """
    try:
        await db.discovered_jobs.create_index(
            "discovered_at",
            expireAfterSeconds=45 * 24 * 3600,
            name="ttl_discovered_at_45d",
        )
    except Exception as e:
        logger.warning("TTL index ensure failed (continuing): %s", e)
