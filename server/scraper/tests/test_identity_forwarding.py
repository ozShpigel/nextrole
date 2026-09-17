"""Identity must cross the scraper -> API boundary, or writes are orphaned.

The C# side makes per-user scoping structural: repositories only ever see a
UserScopedCollection, which has no overload that skips the filter. None of
that reaches Python. Over here a user-scoped call is an ordinary HTTP request,
and one that forgets to send the uid cookie does not fail: the API's
IdentityResolver mints a fresh id, files the write under it, and returns 201.
The row is then invisible to the person who asked for it and to everyone else.

That is not hypothetical, and it has now happened twice:

  * `POST /api/discovery/jobs/{id}/save` first shipped sending NO identity, and
    "Add" silently wrote applications nobody could see.
  * It then shipped sending the WRONG identity. The cookie used to be the
    userId, so forwarding the resolved id was correct; sessions made the cookie
    an opaque token, and a raw Guid stopped resolving. The API answered by
    minting a fresh id — the same silent orphaning, from a call site that
    looked like it was doing the right thing, and that these tests passed on.

So there are two rules, not one, and the second is the one the old version of
this file missed:

  1. Every call site says which it is, in source. An explicit None marks a
     genuinely user-independent call (triage, seniority, job facts) and is a
     decision; a missing argument is an oversight, and this fails on it.
  2. What goes on the wire is the CREDENTIAL the API can resolve — the session
     token — and never the userId it resolved to.
"""
import ast
import inspect
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import identity
from app.config import Settings
from app.identity import RequestIdentity
from app.services import match_client, tracker_client

SERVICES = Path(__file__).resolve().parent.parent / "app" / "services"

# Calls that act on behalf of one user. Each must require an identity.
USER_SCOPED = [
    (tracker_client, "save_to_tracker"),
    (tracker_client, "check_duplicate"),
    (match_client, "score_job"),
    (match_client, "score_job_batch"),
]


def test_request_helper_requires_an_explicit_identity():
    sig = inspect.signature(tracker_client._request_with_retry)
    assert "identity" in sig.parameters, (
        "_request_with_retry is the one place every API call goes through; "
        "identity belongs there")
    assert sig.parameters["identity"].default is inspect.Parameter.empty, (
        "identity must have no default: a default would let a user-scoped call "
        "fall back to anonymous, which is exactly the bug this guards")
    assert "user_id" not in sig.parameters, (
        "a bare user_id is not a credential the API can resolve — it is the "
        "thing that orphaned every Add after sessions shipped")


@pytest.mark.parametrize("module,name", USER_SCOPED, ids=lambda v: getattr(v, "__name__", v))
def test_user_scoped_helpers_require_an_identity(module, name):
    params = inspect.signature(getattr(module, name)).parameters
    param = params.get("identity")
    assert param is not None, f"{name} acts for one user and must take identity"
    assert param.default is inspect.Parameter.empty, (
        f"{name}'s identity must be required, not defaulted")
    assert "user_id" not in params, (
        f"{name} must take the RequestIdentity, not a loose user_id — the two "
        "are not interchangeable on the wire")


def _call_sites():
    """Every `_request_with_retry(...)` call in app/services, as AST nodes."""
    for path in sorted(SERVICES.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            fname = getattr(func, "attr", None) or getattr(func, "id", None)
            if fname == "_request_with_retry":
                yield path.name, node


def test_every_api_call_states_whose_it_is():
    sites = list(_call_sites())
    assert sites, "no _request_with_retry call sites found - has it been renamed?"
    missing = [
        f"{name}:{node.lineno}"
        for name, node in sites
        if not any(kw.arg == "identity" for kw in node.keywords)
    ]
    assert not missing, (
        "these API calls do not say which user they are for, so the API will "
        "mint a throwaway id and orphan the result: " + ", ".join(missing))


class _Recorder:
    """Stands in for httpx.AsyncClient and keeps the last request's kwargs."""

    def __init__(self, sent):
        self._sent = sent

    def __call__(self, **_kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def request(self, _method, _url, **kwargs):
        self._sent.update(kwargs)
        return _Resp()


class _Resp:
    status_code = 200

    def json(self):
        return True


@pytest.mark.asyncio
async def test_the_credential_goes_out_and_the_user_id_does_not(monkeypatch):
    """The regression test for the orphaned-Add bug.

    The previous version of this asserted the userId reached the wire, which is
    precisely what broke — it was green throughout. Pin the token instead, and
    pin the negative too: a userId that also happens to be correct would let
    this pass while the wrong value shipped.
    """
    sent = {}
    monkeypatch.setattr(tracker_client.httpx, "AsyncClient", _Recorder(sent))
    settings = Settings(mongodb_connection_string="mongodb://x")

    user = "11111111-2222-3333-4444-555555555555"
    token = "MPyT3n0BOaQ9m1x4x9uK7tWk5cQ2Q7hJ0ZzT_abcDEF"
    ident = RequestIdentity(user_id=user, credential=token)

    await tracker_client.check_duplicate(settings, "Acme", "Backend Engineer", identity=ident)
    assert sent["cookies"] == {settings.identity_cookie_name: token}
    assert user not in str(sent), (
        "the resolved userId must not reach the API — it is not a credential, "
        "and the API answers one it cannot resolve by minting a new user")

    sent.clear()
    await tracker_client.check_api_reachable(settings)
    assert "cookies" not in sent, (
        "a user-independent call must not carry someone's identity")


class _FakeSessions:
    def __init__(self, doc):
        self._doc = doc

    async def find_one(self, _query):
        return self._doc


class _FakeDb:
    def __init__(self, session=None, linked=None):
        self.sessions = _FakeSessions(session)
        self.googleIdentity = _FakeSessions(linked)


class _FakeRequest:
    def __init__(self, cookies):
        self.cookies = cookies


@pytest.mark.asyncio
async def test_resolve_hands_back_the_token_it_was_given():
    """Resolution yields the id for our own queries and the token for the API.

    Returning only the id is what left the caller with nothing forwardable, so
    it forwarded the id — and the API minted a stranger.
    """
    settings = Settings(mongodb_connection_string="mongodb://x", identity_mode="cookie")
    user = "9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8"
    token = "0pSoM3Rand0mOpaqueSess1onT0ken_xyz"
    db = _FakeDb(session={
        "_id": token,
        "UserId": user,
        "ExpiresAt": datetime.now(timezone.utc) + timedelta(days=1),
    })

    resolved = await identity.resolve(settings, _FakeRequest({"uid": token}), db)
    assert resolved.user_id == user
    assert resolved.credential == token


def test_the_scraper_has_no_user_facing_endpoints_left():
    """Nothing this service serves acts on one user's data.

    The inverse of what this test used to assert. It listed the endpoints that
    had to take an identity; as of Phase 3 of docs/scraper-slimming.md there are
    none, because every user-scoped route moved to the API where
    UserScopedCollection makes the scoping a compile error.

    Asserting the absence is the stronger claim, and it is the one worth
    keeping: a new endpoint here that resolves a user is a step back toward the
    orphaned-write failure this file exists for, and this fails the moment one
    appears.
    """
    main = (SERVICES.parent / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(main)

    resolves_user = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        args = node.args.args + node.args.kwonlyargs
        annotations = " ".join(ast.unparse(a.annotation) for a in args if a.annotation)
        if "RequestIdentity" in annotations or any(a.arg == "user_id" for a in args):
            resolves_user.append(node.name)

    assert not resolves_user, (
        "these endpoints resolve a user, which this service no longer does: "
        + ", ".join(resolves_user)
    )
def test_offline_commands_refuse_to_guess_a_user():
    """The seeder and eval CLIs have no request to resolve. On a multi-user
    instance there is no answer, and inventing one would attribute scores to
    somebody who does not exist."""
    fixed = Settings(mongodb_connection_string="mongodb://x", identity_mode="fixed",
                     identity_fixed_user_id="11111111-1111-1111-1111-111111111111")
    assert identity.instance_user_id(fixed) == "11111111-1111-1111-1111-111111111111"
    assert identity.instance_identity(fixed) == RequestIdentity(
        user_id="11111111-1111-1111-1111-111111111111",
        credential="11111111-1111-1111-1111-111111111111")

    cookie = Settings(mongodb_connection_string="mongodb://x", identity_mode="cookie")
    with pytest.raises(RuntimeError, match="single configured user"):
        identity.instance_user_id(cookie)
    with pytest.raises(RuntimeError, match="single configured user"):
        identity.instance_identity(cookie)
