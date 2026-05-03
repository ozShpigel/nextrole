def extract_flat(match_analysis: dict) -> tuple[int | None, str | None, bool | None]:
    """Pull sort/filter fields out of the rich MatchResponse."""
    score = match_analysis.get("overallScore")
    verdict = match_analysis.get("verdict")
    recommendation = match_analysis.get("recommendation") or {}
    should_apply = recommendation.get("shouldApply")
    return score, verdict, should_apply
