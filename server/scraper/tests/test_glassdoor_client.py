"""Regression tests for the Glassdoor DDG-snippet parsing.

The regexes are the fragile part of the enrichment — these fixtures are
modeled on real DuckDuckGo snippet phrasing observed for Glassdoor results.
"""

import pytest

from app.services import glassdoor_client
from app.services.glassdoor_client import (
    _SUB_RATING_RE,
    _clean_text,
    _parse_rating_text,
    _parse_reviews,
)

WIX_STYLE_HTML = (
    "<div class='result'>Wix has an overall rating of 4.0 out of 5, based on over "
    "2,168 reviews left anonymously by employees. 82% of employees would recommend "
    "working at Wix to a friend. Employees also rated Wix 4.2 out of 5 for work life "
    "balance, 4.2 for culture and values and 3.7 for career opportunities.</div>"
)


def test_parse_reviews_sub_ratings():
    result = _parse_reviews(WIX_STYLE_HTML)
    assert result["subRatings"] == {
        "workLifeBalance": 4.2,
        "cultureAndValues": 4.2,
        "careerOpportunities": 3.7,
    }


def test_parse_reviews_recommend_percent():
    result = _parse_reviews(WIX_STYLE_HTML)
    assert result["recommendPercent"] == 82


def test_parse_reviews_snippets():
    result = _parse_reviews(WIX_STYLE_HTML)
    assert 1 <= len(result["snippets"]) <= 2
    assert any("would recommend" in s for s in result["snippets"])
    assert all(len(s) <= 300 for s in result["snippets"])


def test_parse_reviews_alternate_phrasings():
    html = (
        "Employees rated Acme 3.9 out of 5 for culture &amp; values, "
        "2.8 for senior management and 4.1 for compensation and benefits."
    )
    result = _parse_reviews(html)
    assert result["subRatings"] == {
        "cultureAndValues": 3.9,
        "seniorManagement": 2.8,
        "compensationAndBenefits": 4.1,
    }


def test_parse_reviews_first_hit_per_category_wins():
    html = "rated 4.2 for work life balance ... rated 3.1 for work life balance"
    result = _parse_reviews(html)
    assert result["subRatings"] == {"workLifeBalance": 4.2}


def test_parse_reviews_ignores_out_of_range():
    html = "rated 0.5 for work life balance and 120% of employees would recommend"
    result = _parse_reviews(html)
    assert "subRatings" not in result
    assert "recommendPercent" not in result


def test_parse_reviews_no_match_returns_empty():
    assert _parse_reviews("<p>Totally unrelated search results.</p>") == {}


def test_parse_reviews_ddg_bolded_query_terms():
    # DDG wraps query terms in <b> tags; de-tagging must not leave
    # multi-space runs that break the phrase regexes (real-probe regression).
    html = (
        "82% of Wix employees would recommend working there to a friend based on "
        "<b>Glassdoor</b> <b>reviews</b>. Employees also rated <b>Wix</b> 4.2 out of 5 "
        "for <b>work</b> <b>life</b> <b>balance</b>, 4.2 for culture and values and "
        "3.7 for career opportunities."
    )
    result = _parse_reviews(html)
    assert result["subRatings"]["workLifeBalance"] == 4.2
    assert result["recommendPercent"] == 82
    # And the strip guard still prevents the bolded sub-rating sentence from
    # being read as an overall rating.
    stripped = _SUB_RATING_RE.sub(" ", _clean_text(html))
    assert _parse_rating_text(stripped, html) is None


def test_review_count_from_based_on_sentence():
    text = _clean_text(WIX_STYLE_HTML)
    assert glassdoor_client._parse_review_count(text) == 2168


def test_review_count_prefers_title_form():
    assert glassdoor_client._parse_review_count("Reviews (512) ... based on 2,168 reviews") == 512


def test_sub_rating_not_mistaken_for_overall():
    # A page with ONLY sub-rating sentences must not yield an overall rating
    # once the sub-rating spans are stripped (the fetch cascade does this).
    html = "Employees also rated Wix 4.2 out of 5 for work life balance."
    stripped = _SUB_RATING_RE.sub(" ", _clean_text(html))
    assert _parse_rating_text(stripped, html) is None


def test_overall_rating_survives_stripping():
    stripped = _SUB_RATING_RE.sub(" ", _clean_text(WIX_STYLE_HTML))
    result = _parse_rating_text(stripped, WIX_STYLE_HTML)
    assert result is not None
    assert result["rating"] == 4.0
    assert result["reviewCount"] == 2168


@pytest.mark.asyncio
async def test_fetch_merges_deep_and_overall(monkeypatch):
    async def fake_search(query):
        return WIX_STYLE_HTML

    monkeypatch.setattr(glassdoor_client, "_search_ddg", fake_search)
    result = await glassdoor_client.fetch_glassdoor_rating("Wix")
    assert result["rating"] == 4.0
    assert result["reviewCount"] == 2168
    assert result["subRatings"]["workLifeBalance"] == 4.2
    assert result["recommendPercent"] == 82


@pytest.mark.asyncio
async def test_fetch_nothing_found_returns_none_and_caches(monkeypatch):
    calls = []

    async def fake_search(query):
        calls.append(query)
        return "<p>no glassdoor data here</p>"

    monkeypatch.setattr(glassdoor_client, "_search_ddg", fake_search)
    cache = {}
    result = await glassdoor_client.fetch_glassdoor_rating("Gloat", cache)
    assert result is None
    assert cache["gloat"] is None
    assert len(calls) == 3  # full cascade attempted

    calls.clear()
    assert await glassdoor_client.fetch_glassdoor_rating("Gloat", cache) is None
    assert calls == []  # negative cache hit, no new queries
