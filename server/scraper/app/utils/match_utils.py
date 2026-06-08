def extract_flat(match_analysis: dict) -> tuple[int | None, str | None, bool | None]:
    """Pull sort/filter fields out of the rich MatchResponse."""
    score = match_analysis.get("overallScore") or match_analysis.get("totalScore")
    verdict = match_analysis.get("verdict")
    recommendation = match_analysis.get("recommendation") or {}
    should_apply = recommendation.get("shouldApply")
    if should_apply is None and verdict:
        should_apply = verdict in ("STRONG_YES", "YES", "MAYBE")
    return score, verdict, should_apply
