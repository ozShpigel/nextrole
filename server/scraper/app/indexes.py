import logging

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)


TTL_INDEX_NAME = "ttl_discovered_at_45d"
TTL_SECONDS = 60 * 24 * 3600  # 60 days


# Retention applies to the criteria-driven path only. Step 4 says an expired
# pool listing is marked inactive and never deleted, so pool jobs must not be
# deletion candidates — and a comment saying so is not a mechanism.
#
# Expressed as a POSITIVE marker on the documents that DO expire, because a
# partial index filter cannot say "field is absent": Mongo allows only
# $exists:true, $eq, $type, comparisons, $and/$or/$in there, and rejects the
# $not that "$exists: false" desugars to. DiscoveredJob defaults ttl_managed to
# True and the pool path sets it False; _backfill_ttl_managed below stamps rows
# written before the field existed.
TTL_MANAGED_INDEX_NAME = "ttl_discovered_at_60d_managed"
TTL_PARTIAL_FILTER = {"ttl_managed": True}


def _is_pool_exempt_ttl(spec: dict) -> bool:
    """Is this actually the pool-exempt retention index, or just its name?"""
    key = [tuple(k) for k in spec.get("key", [])]
    return (
        key == [("discovered_at", 1)]
        and "expireAfterSeconds" in spec
        and dict(spec.get("partialFilterExpression") or {}) == TTL_PARTIAL_FILTER
    )


class TtlRebuildFailed(RuntimeError):
    """The pool is unprotected from the retention TTL. Not recoverable in-process."""


async def ensure_ttl_index(db: AsyncIOMotorDatabase) -> None:
    """Retention: purge criteria-driven discovered jobs after 60 days so the M0
    tier (512MB) never fills up. Safe — jobs saved to the tracker are full
    copies in the tracker DB. Idempotent; called from both the web service
    startup and the CLI, so a cron-only deploy keeps retention too.

    Bumped from 45 (was: RAG-era docs carried a ~12KB embedding vector on top
    of ~6-8KB of other fields). Removing it frees real headroom, but this
    isn't a full 65% shrink — per-job scoring reintroduces its own weight
    (match_analysis, both Claude call snapshots). 60 is a modest bump, not a
    re-measured number; revisit once real scored-doc sizes are known.

    **This one is fatal.** Every other index ensure here is best-effort, because
    a missing index costs uniqueness guarantees and query speed. That reasoning
    does not transfer to a TTL index, which DELETES ROWS: while the old
    unfiltered index is still in place, every shared-pool job is a deletion
    candidate, and "expired listings are marked inactive, never deleted"
    (docs/job-pool.md) is quietly false. A scraper that cannot complete this
    rebuild must not run; the orchestrator restarting it is the better outcome.

    Migrating off the old unfiltered index creates the new one FIRST and drops
    the old one only once that succeeded: dropping first left the collection
    with no retention at all when the create then failed.
    """
    await _backfill_ttl_managed(db)

    try:
        info = await db.discovered_jobs.index_information()
    except Exception as e:
        raise TtlRebuildFailed(f"Could not read discovered_jobs indexes: {e}") from e

    existing = info.get(TTL_MANAGED_INDEX_NAME)
    if existing is not None and not _is_pool_exempt_ttl(existing):
        # The name is taken by something that is NOT the pool-exempt TTL. Going
        # down the "already correct" path here would return having done nothing
        # while the old unfiltered index carries on deleting pool jobs — the
        # exact state this function exists to prevent. Checking the shape rather
        # than the name is what makes the guarantee real.
        raise TtlRebuildFailed(
            f"Index {TTL_MANAGED_INDEX_NAME} exists with an unexpected shape ({existing!r}); "
            "refusing to assume the pool is protected"
        )

    if existing is not None:
        # Right shape already — only the expiry can drift, and collMod is the
        # documented way to change it in place. A drift that fails to apply is
        # NOT fatal: the pool is already protected by the partial filter, and
        # only the retention window is wrong.
        try:
            await db.command({
                "collMod": "discovered_jobs",
                "index": {"name": TTL_MANAGED_INDEX_NAME, "expireAfterSeconds": TTL_SECONDS},
            })
        except Exception as e:
            logger.error("TTL expiry update failed (continuing; pool is still protected): %s", e)
        return

    try:
        await db.discovered_jobs.create_index(
            "discovered_at",
            expireAfterSeconds=TTL_SECONDS,
            name=TTL_MANAGED_INDEX_NAME,
            partialFilterExpression=TTL_PARTIAL_FILTER,
        )
    except Exception as e:
        # The old unfiltered index is still in place and still deleting pool
        # jobs on its schedule, which is exactly the state we refuse to serve in.
        raise TtlRebuildFailed(
            f"Could not create the pool-exempt TTL index {TTL_MANAGED_INDEX_NAME}: {e}"
        ) from e

    if TTL_INDEX_NAME in info:
        try:
            await db.discovered_jobs.drop_index(TTL_INDEX_NAME)
            logger.warning(
                "Replaced unfiltered TTL index %s with %s — shared-pool jobs are no longer deletion candidates",
                TTL_INDEX_NAME, TTL_MANAGED_INDEX_NAME,
            )
        except Exception as e:
            # Both indexes now exist. Mongo applies each independently, so the
            # old one still expires pool jobs — same unprotected state.
            raise TtlRebuildFailed(
                f"Created {TTL_MANAGED_INDEX_NAME} but could not drop the old unfiltered "
                f"{TTL_INDEX_NAME}, which still deletes pool jobs: {e}"
            ) from e


async def _backfill_ttl_managed(db: AsyncIOMotorDatabase) -> None:
    """Rows written before ttl_managed existed are all criteria-driven, so they
    keep expiring. Idempotent; a second run matches nothing."""
    try:
        result = await db.discovered_jobs.update_many(
            {"ttl_managed": {"$exists": False}, "pool_key": {"$exists": False}},
            {"$set": {"ttl_managed": True}},
        )
        if result.modified_count:
            logger.info("TTL backfill: marked %d pre-existing job(s) as retention-managed",
                        result.modified_count)
    except Exception as e:
        # Fail-safe, not fail-dangerous: rows without ttl_managed do not match
        # the partial filter, so they stop expiring rather than being deleted.
        # Loud because retention has silently stopped for them.
        logger.error("TTL backfill failed — retention has stopped for un-stamped jobs: %s", e)


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


POOL_KEY_INDEX_NAME = "uniq_pool_key"
POOL_ACTIVE_INDEX_NAME = "idx_pool_active"


async def ensure_pool_indexes(db: AsyncIOMotorDatabase) -> None:
    """Identity and presence indexes for the shared job pool.

    `pool_key` unique (partial, so the criteria-driven path's rows — which have
    no pool_key — are not all collapsed onto a single null): the pool's dedupe
    is a real constraint, not a hopeful check-then-act, so a concurrent run
    cannot insert the same listing twice.

    `(is_active, last_seen_at)` backs the default "live listings" view and the
    age-out sweep.
    """
    try:
        await db.discovered_jobs.create_index(
            "pool_key",
            name=POOL_KEY_INDEX_NAME,
            unique=True,
            partialFilterExpression={"pool_key": {"$exists": True, "$type": "string"}},
        )
        await db.discovered_jobs.create_index(
            [("is_active", 1), ("last_seen_at", -1)],
            name=POOL_ACTIVE_INDEX_NAME,
        )
    except Exception as e:
        # Best-effort on purpose (a missing index costs guarantees and speed,
        # not user isolation) but NOT quiet: without uniq_pool_key the dedupe
        # in _upsert degrades to a check-then-act race and the pool fills with
        # duplicates, which looks like a busy job market rather than a fault.
        logger.error(
            "POOL INDEX ENSURE FAILED (%s) — uniq_pool_key may be missing; pool dedupe is "
            "now best-effort and duplicate listings can accumulate silently. Fix and restart.",
            e, exc_info=True,
        )
