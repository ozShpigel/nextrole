"""Request identity for the scraper service.

Mirrors the API's IdentityResolver (server/api/src/Api/Identity) so both
services resolve the same user the same way, and so nothing downstream of
resolution has to know which deployment it is running as.

Two modes:
  fixed  — private instance, single user, id from IDENTITY_FIXED_USER_ID
  cookie — multi-user instance, id from the `uid` cookie

The cookie carries an OPAQUE SESSION TOKEN, not a userId (docs/auth.md,
Phase 1.5). This module resolves it by reading the `sessions` collection
directly: an API call per request would make the API a hard dependency of this
service's request path, and this service already shares nine collections with
it.

That makes the session document a CROSS-LANGUAGE CONTRACT — its field names and
semantics are fixed by Core/Models/UserSession.cs and are not changeable from
one side alone.

Unlike the API, this service NEVER mints an identity. The API is the only
cookie issuer, so a minted id here could never be written back to the browser:
it would be a phantom user, the request would succeed, and the row would be
invisible to everyone (the failure described in docs/multi-user.md). An
unresolvable cookie is a 401 instead — loud and recoverable beats silent and
permanent.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from app.config import Settings

logger = logging.getLogger(__name__)

# Owner of record for search criteria written before multi-user, on an instance
# with no configured single user. Matches Core.Identity.UserIds.OrphanedLegacyData.
ORPHANED_LEGACY_DATA = "00000000-0000-0000-0000-000000000001"


def validate(settings: Settings) -> None:
    """Fail fast on a misconfigured instance rather than silently serving
    every visitor the same user's data. Called once at startup."""
    if settings.identity_mode not in ("fixed", "cookie"):
        raise RuntimeError(
            f"IDENTITY_MODE must be 'fixed' or 'cookie', got {settings.identity_mode!r}"
        )
    if settings.identity_mode == "fixed" and not _parse(settings.identity_fixed_user_id):
        raise RuntimeError(
            "IDENTITY_MODE is 'fixed' but IDENTITY_FIXED_USER_ID is missing or not a "
            "valid non-nil UUID. Set it to the id of the single user this instance serves."
        )


def legacy_owner_user_id(settings: Settings) -> str:
    """Owner that pre-multi-user documents are migrated onto: this instance's
    own single user when it has one, otherwise a well-known id nothing reads."""
    fixed = _parse(settings.identity_fixed_user_id)
    return fixed if settings.identity_mode == "fixed" and fixed else ORPHANED_LEGACY_DATA


def instance_user_id(settings: Settings) -> str:
    """Identity for work with no HTTP request behind it: the demo seeder and
    the golden-set eval CLIs.

    Only meaningful on a single-user instance, where "the user" is a
    configuration value. On a multi-user instance there is no current user
    outside a request, and scoring against a made-up one would quietly
    produce results attributed to somebody who does not exist — so this
    raises instead of guessing.
    """
    fixed = _parse(settings.identity_fixed_user_id)
    if settings.identity_mode == "fixed" and fixed:
        return fixed
    raise RuntimeError(
        "This command scores against a stored profile and needs a single "
        "configured user: set IDENTITY_MODE=fixed and IDENTITY_FIXED_USER_ID. "
        f"(mode={settings.identity_mode!r})"
    )


async def resolve(settings: Settings, request: Request, db) -> str:
    """Resolve the request's user. Async because a session lookup is a query.

    The API mirror is SessionIdentityResolver.ResolveAsync; keep the two in
    step.
    """
    if settings.identity_mode == "fixed":
        fixed = _parse(settings.identity_fixed_user_id)
        if not fixed:
            raise HTTPException(500, "Identity is not configured on this instance")
        return fixed

    if db is None:
        raise HTTPException(503, "Identity store is unavailable")

    token = request.cookies.get(settings.identity_cookie_name)
    if not token:
        raise HTTPException(401, "No session")

    # Expiry is part of the QUERY. Mongo's TTL monitor runs on its own schedule
    # (roughly once a minute), so the collection reliably holds sessions that
    # are already dead; trusting the index to have swept them would leave a
    # window where an expired session still resolves.
    session = await db.sessions.find_one(
        {"_id": token, "ExpiresAt": {"$gt": datetime.now(timezone.utc)}}
    )
    if session:
        return str(session["UserId"])

    # A pre-sessions cookie: the userId in the clear. Honoured read-only during
    # the cutover window so a visitor mid-migration is not orphaned — but NOT
    # upgraded, because the API is the only cookie issuer and two services
    # minting concurrently would race.
    legacy = _parse(token)
    if legacy and settings.accept_legacy_guid_cookie:
        # Same guard as the API: an account somebody can prove they own is
        # reachable only by proving it. Otherwise presenting a known userId —
        # and a ClaimUserId target is typically hand-written and guessable —
        # would hand over that account.
        if await db.googleIdentity.find_one({"_id": legacy}):
            logger.warning(
                "Rejected a pre-sessions cookie for %s: that account is linked.", legacy
            )
            raise HTTPException(401, "Sign in to reach this account")
        return legacy

    raise HTTPException(401, "No session")


def _parse(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        parsed = uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        return None
    return None if parsed.int == 0 else str(parsed)
