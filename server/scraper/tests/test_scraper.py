from app.services.scraper import _correct_is_remote


def test_hybrid_with_wfh_daycount_is_not_remote():
    # jobspy's own is_remote heuristic false-positives on this exact pattern —
    # "WFH" substring-matches its remote_keywords list with no literal "remote"
    # mention anywhere. Real posting text (Tipalti), trimmed.
    title = "Senior Software Engineer"
    description = "Hybrid Work Model - 2 days WFH, 3 days in our North Tel Aviv offices"
    assert _correct_is_remote(True, title, description) is False


def test_hybrid_model_describing_remote_days_is_not_remote():
    # The hybrid split itself is described using the word "remote" for the
    # WFH portion — a literal "remote" mention is present, but the overall
    # arrangement is hybrid, not remote. Real posting text (NiCE), trimmed.
    title = "Cloud & AI Security Operations Engineer"
    description = (
        "At NiCE we work according to the NiCE-Flex hybrid model, which enables "
        "maximum flexibility: 2 days working from the office and 3 days of "
        "remote work, each week."
    )
    assert _correct_is_remote(True, title, description) is False


def test_remote_type_office_self_declaration_is_not_remote():
    # The posting's own structured field explicitly says the remote type is
    # "Office" — jobspy's substring match only sees the word "remote" in the
    # label and misses the value. Real posting text (Genpact) carries
    # markdown-escaping noise between the label and value that a plain
    # `\s*`/`[-:]?` gap would miss, trimmed but noise preserved.
    title = "Engineer - Cloud Technologies"
    description = "Master Skill List \\-**\n\nCloud Technologies S**Remote Type \\-**\n\nOffice**Work Shift \\-**\n\nRotating"
    assert _correct_is_remote(True, title, description) is False


def test_hybrid_environments_technical_usage_stays_remote():
    # "Hybrid" describing infrastructure (cloud + on-prem), not work
    # arrangement — must NOT false-negative a genuinely remote role just
    # because "hybrid" appears in an unrelated technical sentence.
    title = "Senior Platform Engineer"
    description = (
        "We are a remote-first company across the U.S. and EU. "
        "Maintain CI/CD practices and processes including hybrid envs."
    )
    assert _correct_is_remote(True, title, description) is True


def test_team_specific_hybrid_arrangement_is_not_remote():
    # A company-wide "remote-first" claim doesn't guarantee *this* role is
    # remote — the same posting separately states the local team is hybrid.
    # Real posting text (Viz.ai), trimmed.
    title = "Senior Platform Engineer"
    description = (
        "We are a remote-first company across the U.S. and EU, with a team "
        "in Tel Aviv operating in a flexible hybrid model, conveniently "
        "located near a train line."
    )
    assert _correct_is_remote(True, title, description) is False


def test_hybrid_daycount_with_digit_in_the_gap_is_not_remote():
    # A digit sitting between "hybrid" and the qualifying word (the day
    # count itself) breaks a [\W_]-only noise gap, since digits are \w.
    # Real posting text (Check Point), trimmed.
    title = "Senior Software Developer"
    description = "This role is based in Israel — hybrid, 3 days a week from the office."
    assert _correct_is_remote(True, title, description) is False


def test_mainly_in_office_with_occasional_wfh_is_not_remote():
    # The stated PRIMARY arrangement is in-office; WFH is an occasional
    # exception, not the job's actual work location. Real posting text
    # (Matchi), trimmed.
    title = "Junior Founding Software Engineer"
    description = "Atidim Park, Tel Aviv. Mainly in-office, with flexible work from home when needed."
    assert _correct_is_remote(True, title, description) is False


def test_optional_in_office_days_for_remote_role_stays_remote():
    # A bare "in-office" mention without a "mainly/primarily/mostly"
    # qualifier must not false-negative a genuinely remote role that offers
    # optional in-office days for team events.
    title = "Senior Software Engineer"
    description = "Fully remote position. Optional in-office days for team events, never required."
    assert _correct_is_remote(True, title, description) is True


def test_genuinely_remote_stays_remote():
    title = "Senior Software Engineer"
    description = "This is a fully remote position, work from anywhere."
    assert _correct_is_remote(True, title, description) is True


def test_remote_or_hybrid_phrasing_is_corrected():
    # Explicit "hybrid work" phrasing wins even when "remote" is offered as an
    # alternative — there's no tri-state "could be either" flag downstream,
    # and a role that's explicitly sometimes-hybrid isn't confidently remote.
    title = "Senior Software Engineer"
    description = "We offer remote or hybrid work arrangements."
    assert _correct_is_remote(True, title, description) is False


def test_non_remote_untouched():
    assert _correct_is_remote(False, "Engineer", "Onsite role, 5 days in office.") is False


def test_none_untouched():
    assert _correct_is_remote(None, "Engineer", "No work-arrangement stated.") is None


# --- NaN handling ------------------------------------------------------
# jobspy builds one DataFrame per job, drops each one's all-NA columns, then
# concatenates. A field that only SOME jobs in a batch have therefore arrives
# as float NaN rather than None — and str(NaN) == "nan", bool(NaN) is True.
# This produced 11 stored jobs with the literal description "nan" in July 2026.


def _mixed_nan_frame():
    """Reproduces jobspy's concat exactly: job A has a description and an
    is_remote flag (its detail fetch succeeded), job B has neither (its
    detail fetch timed out and returned {})."""
    import pandas as pd

    dfs = [
        pd.DataFrame([{
            "title": "Backend Engineer", "company": "Acme", "location": "Tel Aviv",
            "description": "Real description text.", "job_url": "https://x/a",
            "site": "linkedin", "is_remote": False, "date_posted": "2026-09-01",
        }]),
        pd.DataFrame([{
            "title": "Platform Engineer", "company": "Beta", "location": None,
            "description": None, "job_url": "https://x/b",
            "site": "linkedin", "is_remote": None, "date_posted": "2026-09-02",
        }]),
    ]
    return pd.concat([d.dropna(axis=1, how="all") for d in dfs], ignore_index=True)


def _scrape_with(monkeypatch, df):
    from app.models.search_criteria import SearchCriteria
    from app.services import scraper as scraper_module

    monkeypatch.setattr(scraper_module, "scrape_jobs", lambda **kw: df)
    criteria = SearchCriteria(name="t", job_titles=["Backend Engineer"], locations=["Tel Aviv"])
    jobs, _stats = scraper_module.scrape_for_criteria(criteria)
    return {j["title"]: j for j in jobs}


def test_missing_description_is_empty_not_the_text_nan(monkeypatch):
    jobs = _scrape_with(monkeypatch, _mixed_nan_frame())
    assert jobs["Platform Engineer"]["description"] == ""
    assert jobs["Backend Engineer"]["description"] == "Real description text."


def test_missing_is_remote_is_unknown_not_true(monkeypatch):
    # bool(NaN) is True: the whole point. An unfetched is_remote must stay
    # None so the job doesn't surface under the Remote filter.
    jobs = _scrape_with(monkeypatch, _mixed_nan_frame())
    assert jobs["Platform Engineer"]["is_remote"] is None
    assert jobs["Backend Engineer"]["is_remote"] is False


def test_missing_location_is_empty_not_the_text_nan(monkeypatch):
    jobs = _scrape_with(monkeypatch, _mixed_nan_frame())
    assert jobs["Platform Engineer"]["location"] == ""


def test_missing_job_url_does_not_poison_the_dedup_set(monkeypatch):
    # "nan" is truthy, so a NaN job_url used to enter seen_urls and every
    # LATER url-less row was then silently dropped as a duplicate of it.
    import pandas as pd

    dfs = [
        pd.DataFrame([{"title": "Has URL", "company": "A", "description": "d",
                       "job_url": "https://x/a", "site": "linkedin"}]),
        pd.DataFrame([{"title": "No URL 1", "company": "B", "description": "d",
                       "job_url": None, "site": "linkedin"}]),
        pd.DataFrame([{"title": "No URL 2", "company": "C", "description": "d",
                       "job_url": None, "site": "linkedin"}]),
    ]
    df = pd.concat([d.dropna(axis=1, how="all") for d in dfs], ignore_index=True)
    jobs = _scrape_with(monkeypatch, df)
    assert set(jobs) == {"Has URL", "No URL 1", "No URL 2"}
    assert jobs["No URL 1"]["job_url"] == ""


def test_clean_bool_treats_nan_as_unknown():
    import numpy as np

    from app.services.scraper import _clean_bool

    assert _clean_bool(np.nan) is None
    assert _clean_bool(None) is None
    assert _clean_bool(True) is True
    assert _clean_bool(False) is False


# --- LinkedIn job-id extraction ----------------------------------------


def test_slugged_linkedin_url_yields_the_job_id():
    # Public LinkedIn job links carry a title slug before the id; these used
    # to fail to match at all, so a valid pasted link was rejected offline.
    from app.services.scraper import _LINKEDIN_JOB_ID_RE

    m = _LINKEDIN_JOB_ID_RE.search(
        "https://www.linkedin.com/jobs/view/senior-data-engineer-at-acme-4123456789"
    )
    assert m and m.group(1) == "4123456789"


def test_slug_containing_digits_still_yields_the_trailing_job_id():
    from app.services.scraper import _LINKEDIN_JOB_ID_RE

    m = _LINKEDIN_JOB_ID_RE.search(
        "https://www.linkedin.com/jobs/view/web3-engineer-at-acme-4123456789?refId=x"
    )
    assert m and m.group(1) == "4123456789"


def test_bare_and_query_param_linkedin_urls_still_match():
    from app.services.scraper import _LINKEDIN_JOB_ID_RE

    assert _LINKEDIN_JOB_ID_RE.search(
        "https://www.linkedin.com/jobs/view/4123456789/").group(1) == "4123456789"
    assert _LINKEDIN_JOB_ID_RE.search(
        "https://www.linkedin.com/jobs/search/?currentJobId=4123456789").group(1) == "4123456789"


def test_non_linkedin_url_does_not_match():
    from app.services.scraper import _LINKEDIN_JOB_ID_RE

    assert _LINKEDIN_JOB_ID_RE.search("https://example.com/careers/backend") is None
