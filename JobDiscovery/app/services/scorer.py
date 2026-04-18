import json
import logging
import re
from pathlib import Path

import anthropic

from app.config import Settings

logger = logging.getLogger(__name__)

_system_template_cache: str | None = None
_user_template_cache: str | None = None


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


def _load_prompt_templates() -> tuple[str, str]:
    """Load system + user prompt templates (cached)."""
    global _system_template_cache, _user_template_cache
    if _system_template_cache is None or _user_template_cache is None:
        prompts_dir = Path(__file__).parent.parent / "prompts"
        _system_template_cache = (prompts_dir / "discovery_scorer_system.md").read_text(encoding="utf-8")
        _user_template_cache = (prompts_dir / "discovery_scorer_user.md").read_text(encoding="utf-8")
    return _system_template_cache, _user_template_cache


def _extract_json(text: str) -> dict:
    """Extract JSON from Claude response, handling markdown code blocks."""
    cleaned = re.sub(r"```(?:json)?\s*", "", text).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return json.loads(cleaned)


def _first_text_block(response) -> str:
    """Return the text from the first text-type content block (skip thinking blocks)."""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text
    raise ValueError("Claude response contained no text block")


async def score_job(
    settings: Settings,
    title: str,
    company: str,
    location: str | None,
    description: str | None,
    date_posted: str | None,
    site: str,
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
    system_template, user_template = _load_prompt_templates()

    system_prompt = system_template.replace("{{PROFILE}}", profile)
    user_prompt = (
        user_template
        .replace("{{TITLE}}", title)
        .replace("{{COMPANY}}", company)
        .replace("{{LOCATION}}", location or "לא צוין")
        .replace("{{DATE_POSTED}}", date_posted or "לא צוין")
        .replace("{{SITE}}", site)
        .replace("{{DESCRIPTION}}", description)
    )

    # Load scoring config from MongoDB
    model = settings.claude_model
    max_tokens = 1024
    temperature = 0.3
    thinking_enabled = True
    thinking_budget = 1024
    if db is not None:
        config_doc = await db.profile.find_one({"id": "default"})
        if config_doc and config_doc.get("scoring_config"):
            sc = config_doc["scoring_config"]
            model = sc.get("model", model)
            temperature = sc.get("temperature_discovery", temperature)
            max_tokens = sc.get("max_tokens_discovery", max_tokens)
            thinking_enabled = sc.get("thinking_enabled_discovery", thinking_enabled)
            thinking_budget = sc.get("thinking_budget_discovery", thinking_budget)

    request_kwargs: dict = {
        "model": model,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    if thinking_enabled:
        # Extended thinking requires temperature=1 and max_tokens > budget_tokens
        effective_max_tokens = max(max_tokens, thinking_budget + 1024)
        request_kwargs["max_tokens"] = effective_max_tokens
        request_kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
    else:
        request_kwargs["max_tokens"] = max_tokens
        request_kwargs["temperature"] = temperature

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    logger.info("=== Claude scoring request ===")
    logger.info("Model: %s | Max tokens: %d | Thinking: %s (budget=%s)",
                 model, request_kwargs["max_tokens"], thinking_enabled,
                 thinking_budget if thinking_enabled else "-")
    if not thinking_enabled:
        logger.info("Temperature: %s", temperature)
    logger.info("Job: '%s' at '%s' (%s)", title, company, location or "no location")
    logger.info("Description length: %d chars", len(description))
    logger.info("System prompt length: %d chars (profile: %d)",
                 len(system_prompt), len(profile))
    logger.info("User prompt length: %d chars", len(user_prompt))

    try:
        response = client.messages.create(**request_kwargs)

        text = _first_text_block(response)
        logger.info("Claude response text length: %d chars", len(text))
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
