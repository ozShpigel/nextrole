import json
import logging
import re
from pathlib import Path

import anthropic

from app.config import Settings

logger = logging.getLogger(__name__)

_prompt_template_cache: str | None = None


async def _load_profile(settings: Settings, db=None) -> str:
    """Load profile from MongoDB, falling back to file."""
    if db is not None:
        doc = await db.profile.find_one({"id": "default"})
        if doc and doc.get("content"):
            logger.info("Profile loaded from MongoDB (%d chars)", len(doc["content"]))
            return doc["content"]
    # Fallback to file
    file_path = Path(settings.profile_path)
    if file_path.exists():
        content = file_path.read_text(encoding="utf-8")
        logger.info("Profile loaded from file (%d chars)", len(content))
        return content
    raise FileNotFoundError(f"Profile not found in MongoDB or at {settings.profile_path}")


def _load_prompt_template() -> str:
    global _prompt_template_cache
    if _prompt_template_cache is None:
        _prompt_template_cache = (
            Path(__file__).parent.parent / "prompts" / "discovery_scorer.md"
        ).read_text(encoding="utf-8")
    return _prompt_template_cache


def _extract_json(text: str) -> dict:
    """Extract JSON from Claude response, handling markdown code blocks."""
    # Strip markdown code fences
    cleaned = re.sub(r"```(?:json)?\s*", "", text).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return json.loads(cleaned)


async def score_job(
    settings: Settings,
    title: str,
    company: str,
    location: str | None,
    description: str | None,
    date_posted: str | None,
    site: str,
    values: list[str],
    preferences: str,
    db=None,
) -> dict:
    """Score a single job against the professional profile using Claude."""
    if not description or len(description) < 50:
        return {
            "score": None,
            "verdict": "INSUFFICIENT_DATA",
            "shouldApply": False,
            "keyStrengths": [],
            "keyConcerns": [],
            "honestAssessment": "תיאור המשרה קצר מדי לניתוח",
        }

    profile = await _load_profile(settings, db)
    template = _load_prompt_template()

    values_text = ", ".join(values) if values else "לא צוינו"
    preferences_text = preferences or "לא צוינו"

    prompt = (
        template
        .replace("{{PROFILE}}", profile)
        .replace("{{VALUES_AND_PREFERENCES}}", f"ערכים: {values_text}\nהעדפות: {preferences_text}")
        .replace("{{TITLE}}", title)
        .replace("{{COMPANY}}", company)
        .replace("{{LOCATION}}", location or "לא צוין")
        .replace("{{DATE_POSTED}}", date_posted or "לא צוין")
        .replace("{{SITE}}", site)
        .replace("{{DESCRIPTION}}", description)
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    logger.info("=== Claude scoring request ===")
    logger.info("Model: %s | Max tokens: 1024 | Temperature: 0.3", settings.claude_model)
    logger.info("Job: '%s' at '%s' (%s)", title, company, location or "no location")
    logger.info("Description length: %d chars", len(description))
    logger.info("Profile length: %d chars", len(profile))
    logger.info("Values: %s", values_text)
    logger.info("Preferences: %s", preferences_text)
    logger.info("Total prompt length: %d chars", len(prompt))

    try:
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=1024,
            temperature=0.3,
            messages=[{"role": "user", "content": prompt}],
        )

        text = response.content[0].text
        logger.info("Claude response length: %d chars", len(text))
        logger.info("Usage: input=%s, output=%s tokens",
                     response.usage.input_tokens, response.usage.output_tokens)
        result = _extract_json(text)

        return {
            "score": result.get("score"),
            "verdict": result.get("verdict", "INSUFFICIENT_DATA"),
            "shouldApply": result.get("shouldApply", False),
            "keyStrengths": result.get("keyStrengths", []),
            "keyConcerns": result.get("keyConcerns", []),
            "honestAssessment": result.get("honestAssessment", ""),
        }
    except Exception as e:
        logger.error("Claude scoring failed for '%s' at '%s': %s", title, company, e)
        return {
            "score": None,
            "verdict": "ERROR",
            "shouldApply": False,
            "keyStrengths": [],
            "keyConcerns": [],
            "honestAssessment": f"שגיאה בניתוח: {e}",
        }
