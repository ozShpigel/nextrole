"""Request identity for the scraper service.

Mirrors the API's IdentityResolver (server/api/src/Api/Identity) so both
services resolve the same user the same way, and so nothing downstream of
resolution has to know which deployment it is running as.

Two modes:
  fixed  — private instance, single user, id from IDENTITY_FIXED_USER_ID
  cookie — multi-user instance, id from the `uid` cookie

As on the API side, an absent cookie mints a fresh id rather than falling back
to some shared account. Minting creates no document: the first row for a user
appears only when they actually write something.
"""

import logging
import uuid

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


def resolve(settings: Settings, request: Request) -> str:
    if settings.identity_mode == "fixed":
        fixed = _parse(settings.identity_fixed_user_id)
        if not fixed:
            raise HTTPException(500, "Identity is not configured on this instance")
        return fixed

    from_cookie = _parse(request.cookies.get(settings.identity_cookie_name))
    return from_cookie or str(uuid.uuid4())


def _parse(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        parsed = uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        return None
    return None if parsed.int == 0 else str(parsed)
