"""Unit tests for the job-embedding text composition (pure function).

The OpenAI call itself isn't tested here — embed_texts is a thin batched
wrapper whose failure mode (None per text) is exercised via a stubbed client.
"""
import pytest

from app.services.embeddings import MAX_DESC_CHARS, build_job_embedding_text


def test_full_job_includes_all_fields():
    text = build_job_embedding_text({
        "title": "Platform Engineer",
        "company": "Acme",
        "location": "Tel Aviv",
        "job_level": "mid-senior level",
        "description": "Build internal tooling.",
    })
    assert "Job title: Platform Engineer" in text
    assert "Company: Acme" in text
    assert "Location: Tel Aviv" in text
    assert "Seniority: mid-senior level" in text
    assert text.endswith("Description:\nBuild internal tooling.")


def test_missing_optional_fields_are_omitted():
    text = build_job_embedding_text({"title": "DevOps", "company": "Acme"})
    assert "Location:" not in text
    assert "Seniority:" not in text
    assert "Description:\n" in text  # always present, even when empty


def test_none_description_is_safe():
    text = build_job_embedding_text({"title": "X", "company": "Y", "description": None})
    assert text.endswith("Description:\n")


def test_long_description_is_truncated():
    text = build_job_embedding_text({
        "title": "X", "company": "Y", "description": "a" * (MAX_DESC_CHARS + 500),
    })
    desc = text.split("Description:\n", 1)[1]
    assert len(desc) == MAX_DESC_CHARS


@pytest.mark.asyncio
async def test_embed_texts_empty_input():
    from app.services.embeddings import embed_texts

    class Settings:
        openai_api_key = ""

    assert await embed_texts(Settings(), []) == []


@pytest.mark.asyncio
async def test_embed_texts_failure_yields_none_per_text(monkeypatch):
    """A failed chunk must map to one None per input text — never raise."""
    from app.services import embeddings

    class FailingEmbeddings:
        async def create(self, **kwargs):
            raise RuntimeError("boom")

    class FailingClient:
        def __init__(self, api_key):
            self.embeddings = FailingEmbeddings()

    monkeypatch.setattr(embeddings, "AsyncOpenAI", FailingClient)

    class Settings:
        openai_api_key = "test"

    out = await embeddings.embed_texts(Settings(), ["a", "b", "c"])
    assert out == [None, None, None]
