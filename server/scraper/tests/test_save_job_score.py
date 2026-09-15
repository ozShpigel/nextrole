"""Adding a pool job to the tracker must carry this user's score with it.

Scoring moved off ingest when the pool became shared (docs/job-pool.md), so
`discovered_jobs.score` / `.verdict` / `.match_analysis` are permanently None on
every job either ingest path writes. `save_job` kept reading them anyway, so
every "Add" from Matches created an application with no score, no verdict and no
analysis -- the user saw 92/STRONG_YES on the card, clicked Add, and the tracked
row had nothing. Silent, because a null score renders as an absent section
rather than an error, and because the money had already been spent to produce
the value being discarded.

These tests pin the join to `jobScores`. The first one fails against the old
code.
"""

import json
import os

import pytest

# app.main validates identity config at import time and raises on a missing
# fixed user id -- deliberate, so a misconfigured deploy fails at startup rather
# than minting orphaned users. That makes the env a precondition of the import
# below, so these two lines must stay above it.
os.environ.setdefault("IDENTITY_MODE", "fixed")
os.environ.setdefault("IDENTITY_FIXED_USER_ID", "11111111-1111-1111-1111-111111111111")

from app import main  # noqa: E402
from app.identity import RequestIdentity  # noqa: E402


class _FakeCollection:
    def __init__(self, doc=None):
        self._doc = doc
        self.queries = []

    async def find_one(self, query, projection=None):
        self.queries.append(query)
        return self._doc


class _FakeDb:
    def __init__(self, job_doc, score_doc):
        self.discovered_jobs = _FakeCollection(job_doc)
        self.jobScores = _FakeCollection(score_doc)


ANALYSIS = json.dumps(
    {"overallScore": 91, "recommendation": {"verdict": "STRONG_YES"}}, ensure_ascii=False
)

# What ingest actually writes today: no score fields at all.
POOL_DOC = {
    "id": "job-1",
    "title": "Backend Engineer",
    "company": "Acme",
    "description": "A posting.",
    "job_url": "https://example.test/1",
}

SCORE_ROW = {
    "JobId": "job-1",
    "Score": 91,
    "Verdict": "STRONG_YES",
    "MatchAnalysis": ANALYSIS,
}

# A resolved request: the id this service queries with, and the session token
# it must replay onward. Deliberately different values -- a test that used the
# same string for both would pass while the wrong one shipped.
IDENT = RequestIdentity(user_id="user-a", credential="sess-token-a")


@pytest.fixture
def saved(monkeypatch):
    """Patch out everything but the join under test, and capture the outbound
    save_to_tracker kwargs."""
    calls = {}

    async def fake_save(**kwargs):
        calls.update(kwargs)
        return "app-1"

    async def fake_is_saved(_db, _user, _job):
        return False

    async def fake_mark_saved(_db, _user, _job):
        return None

    async def fake_logo(_company, _own):
        return None

    monkeypatch.setattr(main.tracker_client, "save_to_tracker", fake_save)
    monkeypatch.setattr(main.pool_state, "is_saved", fake_is_saved)
    monkeypatch.setattr(main.pool_state, "mark_saved", fake_mark_saved)
    monkeypatch.setattr(main, "_resolve_company_logo", fake_logo)
    return calls


@pytest.mark.asyncio
async def test_score_comes_from_this_users_jobScores_row(monkeypatch, saved):
    monkeypatch.setattr(main, "db", _FakeDb(POOL_DOC, SCORE_ROW))

    result = await main.save_job("job-1", ident=IDENT)

    assert result == {"status": "saved"}
    # The whole point: the pool document carries none of these.
    assert saved["score"] == 91
    assert saved["verdict"] == "STRONG_YES"


@pytest.mark.asyncio
async def test_analysis_is_passed_through_not_re_encoded(monkeypatch, saved):
    # JobScore.MatchAnalysis is already a JSON string, unlike the BSON document
    # the pool used to hold. A json.dumps here would store a quoted blob that
    # the client cannot parse.
    monkeypatch.setattr(main, "db", _FakeDb(POOL_DOC, SCORE_ROW))

    await main.save_job("job-1", ident=IDENT)

    assert saved["analysis_json"] == ANALYSIS
    assert json.loads(saved["analysis_json"])["overallScore"] == 91


@pytest.mark.asyncio
async def test_the_row_is_looked_up_for_this_user_and_this_job(monkeypatch, saved):
    # jobScores is shared across users; a lookup that forgot UserId would hand
    # this user somebody else's verdict.
    db = _FakeDb(POOL_DOC, SCORE_ROW)
    monkeypatch.setattr(main, "db", db)

    await main.save_job("job-1", ident=IDENT)

    assert db.jobScores.queries == [{"UserId": "user-a", "JobId": "job-1"}]
    # The CREDENTIAL travels to the API, not the id. Forwarding the id is what
    # made every Add land under a user nobody is.
    assert saved["identity"] == IDENT
    assert saved["identity"].credential == "sess-token-a"


@pytest.mark.asyncio
async def test_a_stale_score_on_the_pool_document_is_never_used(monkeypatch, saved):
    # Defence for pre-migration rows that still carry ingest-era fields: the
    # per-user row is the only truth, even when the pool document disagrees.
    stale = {**POOL_DOC, "score": 42, "verdict": "NO", "match_analysis": {"overallScore": 42}}
    monkeypatch.setattr(main, "db", _FakeDb(stale, SCORE_ROW))

    await main.save_job("job-1", ident=IDENT)

    assert saved["score"] == 91
    assert saved["verdict"] == "STRONG_YES"
    assert saved["analysis_json"] == ANALYSIS


@pytest.mark.asyncio
async def test_an_unscored_job_still_saves(monkeypatch, saved):
    # Add is reachable from a listing that only shows scored jobs, so this is
    # the unusual path -- but losing the add would be worse than saving it bare.
    monkeypatch.setattr(main, "db", _FakeDb(POOL_DOC, None))

    result = await main.save_job("job-1", ident=IDENT)

    assert result == {"status": "saved"}
    assert saved["score"] is None
    assert saved["verdict"] is None
    assert saved["analysis_json"] is None
