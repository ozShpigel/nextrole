"""The cross-check that catches a frozen bad parse.

A stored parse is shared and durable, so a parse that missed the posting's
stated requirements is handed to every user who scores that job, for as long as
the row lives. job-facts read the same posting under a different prompt; where
the two disagree about what is required, one of them is wrong, and the parse is
the one with consequences.

The threshold is measured, not chosen: across 61 production jobs stating at
least one must-have, coverage was 1.00 on 49 of them, and there is nothing at
all between 0.33 and 0.67. 0.5 sits in that gap.
"""
import pytest

from app.services import parse_quality


def parsed(**kw) -> dict:
    base = {
        "namedTechnologies": [],
        "requiredSkills": [],
        "niceToHaveSkills": [],
        "technicalRequirements": {},
    }
    base.update(kw)
    return base


def facts(*must) -> dict:
    return {"must_have_tech": list(must)}


# --- not measurable is not the same as bad -------------------------------

def test_no_parse_is_not_measurable():
    assert parse_quality.coverage(None, facts("python")) is None
    assert parse_quality.coverage({}, facts("python")) is None


def test_a_posting_stating_no_requirements_is_not_measurable():
    # Must not collapse into 0.0 -- every requirement-free posting would then
    # look like a parse failure, and 8 of 69 live jobs are in this state.
    assert parse_quality.coverage(parsed(namedTechnologies=["go"]), facts()) is None
    assert parse_quality.coverage(parsed(namedTechnologies=["go"]), {}) is None
    assert parse_quality.coverage(parsed(namedTechnologies=["go"]), None) is None


# --- what counts as "the Evaluator can see it" ---------------------------

@pytest.mark.parametrize("field", ["namedTechnologies", "requiredSkills", "niceToHaveSkills"])
def test_any_list_field_counts(field):
    # The Evaluator is handed the whole ParsedJob, so a requirement recorded
    # anywhere in it has been communicated. Only one absent from every field is
    # actually lost.
    assert parse_quality.coverage(parsed(**{field: ["Kubernetes"]}), facts("kubernetes")) == 1.0


@pytest.mark.parametrize("bucket", ["languages", "frameworks", "infrastructure", "databases"])
def test_any_technical_requirements_bucket_counts(bucket):
    p = parsed(technicalRequirements={bucket: ["Terraform"]})
    assert parse_quality.coverage(p, facts("terraform")) == 1.0


def test_matching_is_case_insensitive_and_trimmed():
    p = parsed(namedTechnologies=["  KUBERNETES  "])
    assert parse_quality.coverage(p, {"must_have_tech": ["kubernetes"]}) == 1.0


# --- the measure itself ---------------------------------------------------

def test_coverage_is_the_share_of_must_haves_the_parse_mentions():
    p = parsed(namedTechnologies=["python", "docker"])
    assert parse_quality.coverage(p, facts("python", "docker", "terraform", "aws")) == 0.5


def test_the_analyst_naming_extra_technologies_is_not_a_fault():
    # Deliberately asymmetric. The Analyst reads more broadly than job-facts --
    # measured across 69 real jobs it named nothing in zero of them -- so a
    # symmetric measure (Jaccard) would flag the normal case. Only omissions
    # matter.
    p = parsed(namedTechnologies=["python", "fastify", "redis", "grafana"])
    assert parse_quality.coverage(p, facts("python")) == 1.0


def test_a_parse_that_missed_everything_scores_zero():
    p = parsed(namedTechnologies=["excel"])
    assert parse_quality.coverage(p, facts("kubernetes", "terraform")) == 0.0


# --- the threshold --------------------------------------------------------

def test_the_threshold_sits_in_the_measured_gap():
    # Nothing in the production distribution fell between 0.33 and 0.67, so the
    # cut is a property of the data rather than a number someone picked: a
    # modest shift does not change what gets flagged.
    assert 0.33 < parse_quality.MIN_COVERAGE < 0.67


def test_check_flags_below_the_threshold_but_still_returns_the_score(caplog):
    p = parsed(namedTechnologies=["excel"])
    with caplog.at_level("WARNING"):
        score = parse_quality.check("job-1", p, facts("kubernetes", "terraform", "aws"))
    assert score == 0.0
    assert "Parse flagged" in caplog.text
    assert "job-1" in caplog.text


def test_check_is_quiet_when_coverage_is_fine(caplog):
    p = parsed(namedTechnologies=["kubernetes", "terraform"])
    with caplog.at_level("WARNING"):
        score = parse_quality.check("job-2", p, facts("kubernetes", "terraform"))
    assert score == 1.0
    assert "Parse flagged" not in caplog.text


def test_flagging_never_withholds_the_parse():
    # check() reports; it does not filter. A posting is worth more than our
    # confidence about it, and refusing to store would turn a parse failure
    # into a missing job -- the same trade job-facts already makes.
    assert parse_quality.check("job-3", parsed(namedTechnologies=[]), facts("go")) == 0.0
