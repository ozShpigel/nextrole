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
