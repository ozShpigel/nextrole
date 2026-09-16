"""A view is recorded once and never rewritten.

The whole point of the field is to answer "was a score anyone paid for ever
looked at". A second open must not move the timestamp, or "scored Monday,
opened three weeks later" becomes indistinguishable from "opened immediately",
and the question the field exists for gets harder rather than easier.

That property lives in the shape of the update, so these tests assert the
shape. A fake collection rather than a real Mongo because CI has none -- and
because what would break this is somebody rewriting the pipeline as a plain
$set, which is visible in the arguments without a database.
"""
import pytest

from app.services import pool_state


class _FakeCollection:
    def __init__(self):
        self.updates = []

    async def update_one(self, filt, update, upsert=False, **kw):
        self.updates.append({'filter': filt, 'update': update, 'upsert': upsert})

    async def find_one(self, *_a, **_k):
        return None

    def find(self, *_a, **_k):
        raise AssertionError('not used by these tests')


class _FakeDb:
    def __init__(self):
        self.coll = _FakeCollection()

    def __getitem__(self, _name):
        return self.coll


@pytest.mark.asyncio
async def test_a_view_is_keyed_per_user_and_job():
    db = _FakeDb()
    await pool_state.mark_viewed(db, 'user-a', 'job-1')

    u = db.coll.updates[0]
    assert u['filter'] == {'_id': 'user-a:job-1'}
    assert u['upsert'] is True


@pytest.mark.asyncio
async def test_the_first_timestamp_wins():
    """$ifNull in a pipeline update, not $set.

    This is the assertion that matters. A plain $set would overwrite on every
    open, and nothing downstream would notice -- the field would still be
    populated, still queryable, and quietly mean "last viewed" instead of
    "first viewed".
    """
    db = _FakeDb()
    await pool_state.mark_viewed(db, 'user-a', 'job-1')

    update = db.coll.updates[0]['update']
    assert isinstance(update, list), 'must be a pipeline update, not a plain document'
    stage = update[0]['$set']
    viewed = stage['ViewedAt']
    assert isinstance(viewed, dict) and '$ifNull' in viewed, (
        'ViewedAt must be $ifNull-guarded so a second open cannot rewrite the first')
    assert viewed['$ifNull'][0] == '$ViewedAt'


@pytest.mark.asyncio
async def test_it_stamps_the_owner_so_the_row_is_queryable():
    # The _id encodes both, but UserId/JobId are what the aggregation queries
    # group by -- a row with only an _id would be far harder to report on.
    db = _FakeDb()
    await pool_state.mark_viewed(db, 'user-a', 'job-1')

    stage = db.coll.updates[0]['update'][0]['$set']
    assert stage['UserId'] == 'user-a'
    assert stage['JobId'] == 'job-1'


@pytest.mark.asyncio
async def test_marking_a_view_never_touches_saved_or_dismissed():
    """A view is not an action on the job.

    poolJobState is shared by three independent writers; this one must not
    clear a save or a dismiss as a side effect of somebody opening the panel.
    """
    db = _FakeDb()
    await pool_state.mark_viewed(db, 'user-a', 'job-1')

    stage = db.coll.updates[0]['update'][0]['$set']
    assert 'SavedToTracker' not in stage
    assert 'Dismissed' not in stage
