from app.services.orchestrator import _backfill_date_posted, _parse_date_posted


def test_new_date_missing_does_not_update():
    # The exact safety requirement this function exists to guarantee: a
    # flaky re-scrape that comes back with no date_posted must never
    # overwrite a good stored date.
    assert _backfill_date_posted(None, "2026-08-01") is None


def test_new_date_empty_string_does_not_update():
    assert _backfill_date_posted("", "2026-08-01") is None


def test_new_date_unparseable_does_not_update():
    assert _backfill_date_posted("not-a-date", "2026-08-01") is None


def test_existing_missing_and_new_present_updates():
    assert _backfill_date_posted("2026-08-05", None) == "2026-08-05"


def test_new_older_than_existing_does_not_update():
    assert _backfill_date_posted("2026-08-01", "2026-08-05") is None


def test_new_equal_to_existing_does_not_update():
    assert _backfill_date_posted("2026-08-05", "2026-08-05") is None


def test_new_newer_than_existing_updates():
    assert _backfill_date_posted("2026-08-07", "2026-08-05") == "2026-08-07"


def test_both_missing_does_not_update():
    assert _backfill_date_posted(None, None) is None


def test_parse_date_posted_handles_full_timestamp():
    # Real date_posted values are plain YYYY-MM-DD, but the parser should
    # tolerate a longer timestamp string by only reading the date prefix.
    assert _parse_date_posted("2026-08-05T00:00:00Z") == _parse_date_posted("2026-08-05")
