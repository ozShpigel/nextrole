import logging

from openai import AsyncOpenAI

from app.config import Settings

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"  # 1536 dims
EMBEDDING_DIMENSIONS = 1536
# text-embedding-3-small caps at 8191 tokens; 6000 chars keeps the description
# comfortably under it while preserving the parts that carry the signal.
MAX_DESC_CHARS = 6000
# OpenAI accepts up to 2048 inputs per embeddings request; 100 keeps request
# bodies small (job descriptions are long) and failure blast-radius bounded.
CHUNK_SIZE = 100


def build_job_embedding_text(job: dict) -> str:
    """Compose the text that represents a job for semantic matching.

    News/reviews are deliberately excluded — they describe the employer, not
    job<->profile fit, and enrichment now happens at advisor-time for the
    top-N only.
    """
    parts = [
        f"Job title: {job.get('title', '')}",
        f"Company: {job.get('company', '')}",
    ]
    if job.get("location"):
        parts.append(f"Location: {job['location']}")
    if job.get("job_level"):
        parts.append(f"Seniority: {job['job_level']}")
    parts.append(f"Description:\n{(job.get('description') or '')[:MAX_DESC_CHARS]}")
    return "\n".join(parts)


async def embed_texts(settings: Settings, texts: list[str]) -> list[list[float] | None]:
    """Embed texts in chunks of CHUNK_SIZE (one API call per chunk).

    A failed chunk yields None entries for its texts — the caller stores those
    jobs without an embedding and they are simply invisible to $vectorSearch.
    Never raises.
    """
    if not texts:
        return []
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    out: list[list[float] | None] = []
    for i in range(0, len(texts), CHUNK_SIZE):
        chunk = texts[i : i + CHUNK_SIZE]
        try:
            resp = await client.embeddings.create(model=EMBEDDING_MODEL, input=chunk)
            out.extend([d.embedding for d in resp.data])
        except Exception as e:
            logger.error("Embedding chunk %d-%d failed: %s", i, i + len(chunk), e)
            out.extend([None] * len(chunk))
    return out
