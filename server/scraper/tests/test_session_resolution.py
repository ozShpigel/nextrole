"""The scraper resolves an opaque session token, and never invents an identity.

The cookie used to carry the userId in the clear, so `resolve` could parse it
and be done. It now carries an opaque token (docs/auth.md, Phase 1.5), which
changes two things that are easy to regress:

  1. Parsing the cookie as a UUID no longer means anything. If that code came
     back it would not raise — `_parse` would return None, the old fallback
     would mint a fresh uuid4, and every write would land under a phantom user.
     Silently, with 201s. That is exactly the failure test_identity_forwarding
     exists to prevent, arriving from the other direction.

  2. This service must never mint. The API is the only cookie issuer, so an id
     invented here could never reach the browser.

The session document's field names are fixed by Core/Models/UserSession.cs and
are a cross-language contract, so they are asserted literally here — if someone
renames one in C#, this fails rather than the scraper quietly resolving nobody.
"""
import ast
import inspect
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from app import identity
from app.config import Settings

IDENTITY_SRC = Path(identity.__file__).read_text(encoding="utf-8")


def _resolve_fn() -> ast.AsyncFunctionDef:
    tree = ast.parse(IDENTITY_SRC)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "resolve":
            assert isinstance(node, ast.AsyncFunctionDef), (
                "resolve must be async — a session lookup is a query, and a sync "
                "version could only be sync by not doing the lookup."
            )
            return node
    raise AssertionError("app/identity.py has no resolve()")


def test_resolve_never_mints_an_identity():
    """No uuid4 anywhere in resolve. Minting here is the phantom-user bug."""
    fn = _resolve_fn()
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            name = getattr(node.func, "attr", getattr(node.func, "id", ""))
            assert name != "uuid4", (
                "resolve() mints an identity. The API is the only cookie issuer, so "
                "an id invented here can never reach the browser: the request "
                "succeeds and the row is invisible to everyone."
            )


def test_resolve_reads_the_sessions_collection():
    """The lookup is the whole point; without it nothing resolves correctly."""
    assert "db.sessions.find_one" in IDENTITY_SRC, (
        "resolve() no longer reads the sessions collection."
    )


def test_expiry_is_enforced_in_the_query_not_left_to_the_ttl():
    """Mongo's TTL monitor runs on its own schedule, so dead sessions linger."""
    assert '"ExpiresAt": {"$gt"' in IDENTITY_SRC, (
        "The session lookup does not filter on ExpiresAt. The TTL index is "
        "cleanup, not correctness — without this an expired session keeps "
        "resolving until the background sweep happens to run."
    )


def test_session_field_names_match_the_csharp_contract():
    """UserSession.cs owns these names; neither side renames them alone."""
    for field in ('"_id"', '"ExpiresAt"', '"UserId"'):
        assert field in IDENTITY_SRC, (
            f"Session field {field} is missing from the scraper's lookup. "
            "The session document is a cross-language contract with "
            "Core/Models/UserSession.cs."
        )


class _FakeCollection:
    def __init__(self, doc=None):
        self.doc = doc
        self.queries = []

    async def find_one(self, query):
        self.queries.append(query)
        return self.doc


class _FakeDb:
    def __init__(self, session=None, link=None):
        self.sessions = _FakeCollection(session)
        self.googleIdentity = _FakeCollection(link)


class _FakeRequest:
    def __init__(self, cookie=None):
        self.cookies = {"uid": cookie} if cookie is not None else {}


def _settings(**kw) -> Settings:
    return Settings(identity_mode="cookie", **kw)


@pytest.mark.asyncio
async def test_a_live_session_resolves_to_its_user():
    db = _FakeDb(session={"_id": "tok", "UserId": "abc", "ExpiresAt": datetime.now(timezone.utc) + timedelta(days=1)})

    resolved = await identity.resolve(_settings(), _FakeRequest("tok"), db)
    assert resolved.user_id == "abc"
    # The token, not the id it resolved to: it is what the API can resolve,
    # and forwarding the id instead is what orphaned every Add.
    assert resolved.credential == "tok"


@pytest.mark.asyncio
async def test_no_cookie_is_a_401_not_a_new_user():
    with pytest.raises(HTTPException) as e:
        await identity.resolve(_settings(), _FakeRequest(), _FakeDb())
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_an_unknown_token_is_a_401_not_a_new_user():
    with pytest.raises(HTTPException) as e:
        await identity.resolve(_settings(), _FakeRequest("who-knows"), _FakeDb())
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_a_pre_sessions_cookie_still_resolves_during_the_cutover():
    legacy = "22222222-2222-2222-2222-222222222222"

    resolved = await identity.resolve(_settings(), _FakeRequest(legacy), _FakeDb())

    assert resolved.user_id == legacy
    # Replayed verbatim, so the API applies the same cutover rule to the same
    # cookie rather than being handed a value it has to re-derive.
    assert resolved.credential == legacy


@pytest.mark.asyncio
async def test_a_linked_account_is_not_reachable_by_presenting_its_userId():
    """The guard that keeps the cutover from re-opening the hole it closes.

    A ClaimUserId target is typically hand-written and guessable, so without
    this, presenting it would hand over the account on scraper endpoints even
    though the API refuses.
    """
    linked = "11111111-1111-1111-1111-111111111111"
    db = _FakeDb(link={"_id": linked, "GoogleSub": "sub"})

    with pytest.raises(HTTPException) as e:
        await identity.resolve(_settings(), _FakeRequest(linked), db)
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_turning_the_cutover_off_closes_the_legacy_path():
    legacy = "22222222-2222-2222-2222-222222222222"

    with pytest.raises(HTTPException):
        await identity.resolve(
            _settings(accept_legacy_guid_cookie=False), _FakeRequest(legacy), _FakeDb()
        )


@pytest.mark.asyncio
async def test_fixed_mode_is_untouched_by_sessions():
    """The offline CLIs and the private instance depend on this path."""
    fixed = "33333333-3333-3333-3333-333333333333"
    s = Settings(identity_mode="fixed", identity_fixed_user_id=fixed)

    # No db needed at all: identity comes from configuration.
    resolved = await identity.resolve(s, _FakeRequest(), None)
    assert resolved.user_id == fixed
    # Fixed mode ignores the cookie API-side, so the credential is the id.
    assert resolved.credential == fixed
