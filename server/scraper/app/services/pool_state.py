"""One user's relationship to one pool job, other than its score.

`dismissed` and `saved_to_tracker` used to live on the `discovered_jobs`
document itself, which was correct while there was one user and wrong the
moment there were two: the pool is shared, so dismissing a job hid it for
everybody and saving it marked it saved for everybody. They are opinions
about a posting held by a person, exactly like a score, so they live in a
per-user row keyed by (userId, jobId) — the same shape `jobScores` uses.

Separate from `jobScores` rather than two more fields on it, because the
scoring path upserts whole score documents and would overwrite anything this
module had written. Two collections that are never written by the same code
beat one collection with an ordering hazard.

The pool document keeps only what is true of the posting for everyone.
"""

import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

COLLECTION = "poolJobState"


def _key(user_id: str, job_id: str) -> str:
    return f"{user_id}:{job_id}"


async def _set(db: AsyncIOMotorDatabase, user_id: str, job_id: str, fields: dict) -> None:
    await db[COLLECTION].update_one(
        {"_id": _key(user_id, job_id)},
        {"$set": {"UserId": user_id, "JobId": job_id,
                  "UpdatedAt": datetime.now(timezone.utc), **fields}},
        upsert=True,
    )


async def mark_saved(db: AsyncIOMotorDatabase, user_id: str, job_id: str) -> None:
    await _set(db, user_id, job_id, {"SavedToTracker": True})


async def mark_dismissed(db: AsyncIOMotorDatabase, user_id: str, job_id: str) -> None:
    await _set(db, user_id, job_id, {"Dismissed": True})


async def mark_viewed(db: AsyncIOMotorDatabase, user_id: str, job_id: str) -> None:
    """Record the FIRST time this user opened this job's detail panel.

    A view is opening the panel, not the job appearing in a response and not
    scrolling past it. "Was it in the results" is the number we already have;
    the question worth spending a field on is whether a score anyone paid for
    was ever actually looked at.

    First open only, never overwritten -- a pipeline update with $ifNull rather
    than $setOnInsert, because the row usually already exists (saved/dismissed
    write it first) and $setOnInsert would then never fire. Idempotent by
    construction, so the client may call it on every selection without
    guarding, and a second open cannot rewrite the first timestamp.

    A timestamp rather than a bool or a counter: same storage, and it
    distinguishes "scored today, opened three weeks later" from "never opened".
    A counter would invite analysis nobody asked for and make the write
    non-idempotent.
    """
    await db[COLLECTION].update_one(
        {"_id": _key(user_id, job_id)},
        [{"$set": {
            "UserId": user_id,
            "JobId": job_id,
            "ViewedAt": {"$ifNull": ["$ViewedAt", datetime.now(timezone.utc)]},
        }}],
        upsert=True,
    )


async def clear_saved(db: AsyncIOMotorDatabase, user_id: str, job_ids: list[str]) -> int:
    """Reverse of mark_saved for this user only — the other users who saved the
    same posting keep their own row."""
    if not job_ids:
        return 0
    result = await db[COLLECTION].update_many(
        {"UserId": user_id, "JobId": {"$in": job_ids}},
        {"$set": {"SavedToTracker": False, "UpdatedAt": datetime.now(timezone.utc)}},
    )
    return result.modified_count


async def is_saved(db: AsyncIOMotorDatabase, user_id: str, job_id: str) -> bool:
    row = await db[COLLECTION].find_one(
        {"_id": _key(user_id, job_id)}, {"SavedToTracker": 1})
    return bool((row or {}).get("SavedToTracker"))


async def state_for(
    db: AsyncIOMotorDatabase, user_id: str, job_ids: list[str]
) -> dict[str, dict]:
    """{job_id: {"dismissed": bool, "saved": bool}} for the jobs asked about.
    Jobs with no row are simply untouched by this user, so they are absent."""
    if not job_ids:
        return {}
    rows = await db[COLLECTION].find(
        {"UserId": user_id, "JobId": {"$in": job_ids}},
        {"JobId": 1, "Dismissed": 1, "SavedToTracker": 1, "ViewedAt": 1},
    ).to_list(None)
    return {
        r["JobId"]: {"dismissed": bool(r.get("Dismissed")),
                     "saved": bool(r.get("SavedToTracker")),
                     "viewed": r.get("ViewedAt") is not None}
        for r in rows
    }
