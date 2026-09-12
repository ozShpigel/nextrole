"""Identity must cross the scraper -> API boundary, or writes are orphaned.

The C# side makes per-user scoping structural: repositories only ever see a
UserScopedCollection, which has no overload that skips the filter. None of
that reaches Python. Over here a user-scoped call is an ordinary HTTP request,
and one that forgets to send the uid cookie does not fail: the API's
IdentityResolver mints a fresh id, files the write under it, and returns 201.
The row is then invisible to the person who asked for it and to everyone else.

That is not hypothetical — `POST /api/discovery/jobs/{id}/save` shipped that
way and "Add" silently wrote applications nobody could see. So these tests
encode the rule the wrapper encodes on the other side:

  1. `user_id` is a required argument, so omitting it raises rather than
     defaulting to "nobody".
  2. Every call site says which it is, in source. An explicit None marks a
     genuinely user-independent call (triage, seniority, job facts) and is a
     decision; a missing argument is an oversight, and this fails on it.
  3. The cookie really goes on the wire.
  4. The endpoints that act for a user resolve one.
"""
import ast
import inspect
from pathlib import Path

import pytest

from app import identity
from app.config import Settings
from app.services import match_client, tracker_client

SERVICES = Path(__file__).resolve().parent.parent / "app" / "services"

# Calls that act on behalf of one user. Each must require user_id.
USER_SCOPED = [
    (tracker_client, "save_to_tracker"),
    (tracker_client, "check_duplicate"),
    (match_client, "score_job"),
    (match_client, "score_job_batch"),
]


def test_request_helper_requires_an_explicit_user():
    sig = inspect.signature(tracker_client._request_with_retry)
    assert "user_id" in sig.parameters, (
        "_request_with_retry is the one place every API call goes through; "
        "identity belongs there")
    assert sig.parameters["user_id"].default is inspect.Parameter.empty, (
        "user_id must have no default: a default would let a user-scoped call "
        "fall back to anonymous, which is exactly the bug this guards")


@pytest.mark.parametrize("module,name", USER_SCOPED, ids=lambda v: getattr(v, "__name__", v))
def test_user_scoped_helpers_require_a_user(module, name):
    param = inspect.signature(getattr(module, name)).parameters.get("user_id")
    assert param is not None, f"{name} acts for one user and must take user_id"
    assert param.default is inspect.Parameter.empty, (
        f"{name}'s user_id must be required, not defaulted")


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
        if not any(kw.arg == "user_id" for kw in node.keywords)
    ]
    assert not missing, (
        "these API calls do not say which user they are for, so the API will "
        "mint a throwaway id and orphan the result: " + ", ".join(missing))


@pytest.mark.asyncio
async def test_the_uid_cookie_actually_goes_out(monkeypatch):
    sent = {}

    class _Resp:
        status_code = 200

        def json(self):
            return True

    class _Client:
        def __init__(self, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def request(self, _method, _url, **kwargs):
            sent.update(kwargs)
            return _Resp()

    monkeypatch.setattr(tracker_client.httpx, "AsyncClient", _Client)
    settings = Settings(mongodb_connection_string="mongodb://x")
    user = "11111111-2222-3333-4444-555555555555"

    await tracker_client.check_duplicate(settings, "Acme", "Backend Engineer", user_id=user)
    assert sent["cookies"] == {settings.identity_cookie_name: user}

    sent.clear()
    await tracker_client.check_api_reachable(settings)
    assert "cookies" not in sent, (
        "a user-independent call must not carry someone's identity")


def test_user_facing_job_actions_resolve_a_user():
    """The endpoints that act for one user take the identity dependency.

    Read from source rather than from the app object: what matters is that the
    signature declares it, which is what a future edit would drop.
    """
    main = (SERVICES.parent / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(main)
    wanted = {"save_job", "dismiss_job", "unsave_job", "import_jobs",
              "list_scored_jobs"}
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name in wanted:
            args = node.args.args + node.args.kwonlyargs
            found[node.name] = any(a.arg == "user_id" for a in args)
    assert set(found) == wanted, f"endpoints missing from main.py: {wanted - set(found)}"
    unscoped = [name for name, ok in found.items() if not ok]
    assert not unscoped, (
        "these endpoints act on one user's data but resolve no user: "
        + ", ".join(unscoped))


def test_offline_commands_refuse_to_guess_a_user():
    """The seeder and eval CLIs have no request to resolve. On a multi-user
    instance there is no answer, and inventing one would attribute scores to
    somebody who does not exist."""
    fixed = Settings(mongodb_connection_string="mongodb://x", identity_mode="fixed",
                     identity_fixed_user_id="11111111-1111-1111-1111-111111111111")
    assert identity.instance_user_id(fixed) == "11111111-1111-1111-1111-111111111111"

    cookie = Settings(mongodb_connection_string="mongodb://x", identity_mode="cookie")
    with pytest.raises(RuntimeError, match="single configured user"):
        identity.instance_user_id(cookie)
