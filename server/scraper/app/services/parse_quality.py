"""Does the stored parse actually contain what the posting asks for?

WHY THIS EXISTS, AND WHY job-facts AND THE ANALYST MUST STAY TWO CALLS
---------------------------------------------------------------------
Both read the same job description with the same model under different
prompts, and both name the posting's required technologies. Merging them into
one call is the obvious saving -- one JD sent instead of two -- and it is worth
about $0.0007 a job. It would also destroy the only independent check on a
parse that is now SHARED and DURABLE.

That trade was fine when every user parsed for themselves: a bad parse cost one
user one bad score on an artifact thrown away seconds later. A stored parse is
handed to every user who scores that job, for as long as the row lives. The
redundancy is not waste; it is the second opinion that catches the frozen
mistake. If you are here to merge them, this is the cost.

WHAT IT MEASURES
----------------
Coverage: of the technologies job-facts recorded as REQUIRED, what share does
the parse mention anywhere the Evaluator will see -- namedTechnologies,
requiredSkills, niceToHaveSkills, or any technicalRequirements bucket. Low
coverage means the parse missed stated requirements, which is the failure that
matters: the Evaluator cannot score a gap it was never shown, so the score
inflates.

Deliberately asymmetric. The Analyst naming things job-facts did not is normal
and not a fault -- it reads more broadly, and measured across 69 real jobs it
named nothing in 0 of them. So this asks only whether the parse covers the
stricter reading, never whether the two match.

THE THRESHOLD
-------------
Set from the distribution, not from the mean. Measured across 61 production
jobs that state at least one must-have:

    1.00 x49   0.94 x1   0.92 x1   0.89 x1   0.88 x1
    0.85 x2    0.83 x2   0.75 x2   0.67 x1   0.33 x1

Median 1.00, mean 0.96, and a gap with nothing at all between 0.33 and 0.67.
0.5 sits in that empty region, so the cut is a property of the data rather than
a number someone picked: a modest shift in the distribution does not change
what gets flagged. It flags 1 of 61 (1.6%).

FLAG, DO NOT BLOCK
------------------
A flagged parse is still stored and still used. A posting is worth more than
our confidence about it, and refusing to store would make a parse failure into
a missing job -- the same trade job-facts already makes by keeping unextracted
postings. The flag marks the row for re-parse; it does not withhold it.
"""

import logging

logger = logging.getLogger(__name__)

# See THE THRESHOLD above. Change this only with a fresh distribution in hand.
MIN_COVERAGE = 0.5

# Where a technology can appear in a ParsedJob such that the Evaluator sees it.
# The Evaluator is handed the whole ParsedJob, so a requirement recorded in any
# of these has been communicated; only one absent from all of them is lost.
_LIST_FIELDS = ("namedTechnologies", "requiredSkills", "niceToHaveSkills")
_TECH_BUCKETS = ("languages", "frameworks", "infrastructure", "databases")


def _visible_tech(parsed: dict) -> set[str]:
    seen: set[str] = set()
    for field in _LIST_FIELDS:
        seen |= {str(x).strip().lower() for x in (parsed.get(field) or []) if str(x).strip()}
    tech = parsed.get("technicalRequirements") or {}
    for bucket in _TECH_BUCKETS:
        seen |= {str(x).strip().lower() for x in (tech.get(bucket) or []) if str(x).strip()}
    return seen


def coverage(parsed: dict | None, facts: dict | None) -> float | None:
    """Share of job-facts' must-haves the parse mentions anywhere.

    None when the question does not apply: no parse, or the posting states no
    required technology. "Not measurable" and "measured badly" are different
    answers and must not collapse into one, or every requirement-free posting
    would look like a parse failure.
    """
    if not parsed:
        return None
    must = {str(x).strip().lower() for x in ((facts or {}).get("must_have_tech") or []) if str(x).strip()}
    if not must:
        return None
    return len(must & _visible_tech(parsed)) / len(must)


def check(job_id: str, parsed: dict | None, facts: dict | None) -> float | None:
    """Measure and log. Returns the coverage, or None when not measurable."""
    score = coverage(parsed, facts)
    if score is None:
        return None
    if score < MIN_COVERAGE:
        must = [str(x) for x in ((facts or {}).get("must_have_tech") or [])]
        missing = sorted(set(x.lower() for x in must) - _visible_tech(parsed or {}))
        logger.warning(
            "Parse flagged: jobId=%s coverage=%.2f threshold=%.2f missing=%s -- "
            "the stored parse omits requirements job-facts found, so the Evaluator "
            "cannot score the gap. Stored anyway; marked for re-parse.",
            job_id, score, MIN_COVERAGE, missing[:8],
        )
    return score
