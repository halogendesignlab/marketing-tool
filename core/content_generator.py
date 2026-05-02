"""content_generator.py — AI content generation via Claude API."""

import anthropic
from .config_loader import ClientConfig
from portal.api.settings import get_settings

settings = get_settings()
_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 1024


def _call(system: str, user: str) -> str:
    message = _client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": user}],
        system=system,
    )
    return message.content[0].text.strip()


def _brand_context(config: ClientConfig) -> str:
    return (
        f"Brand: {config.brand_name}\n"
        f"Industry: {config.industry}\n"
        f"Location: {config.location.city}, {config.location.state}\n"
        f"Tone: {config.tone}"
    )


# ── Social captions ───────────────────────────────────────────────────────────

PLATFORM_GUIDANCE = {
    "instagram": "Instagram: visual, engaging, 1-3 short paragraphs, 3-5 relevant hashtags at the end.",
    "facebook": "Facebook: conversational, slightly longer, no hashtags needed, encourage engagement.",
    "linkedin": "LinkedIn: professional, value-driven, no hashtags, suitable for a business audience.",
}


def generate_social_caption(config: ClientConfig, platform: str, topic: str | None = None) -> str:
    """Generate a single social media caption for the given platform."""
    guidance = PLATFORM_GUIDANCE.get(platform, "")
    topic_line = f"Topic or focus: {topic}" if topic else "Choose a relevant topic for this brand."

    system = (
        f"You are a marketing copywriter for {config.brand_name}. "
        f"Write in this tone: {config.tone}. "
        f"You are creating content for {config.location.city}, {config.location.state}. "
        "Write only the post copy — no commentary, no labels, no quotation marks."
    )
    user = (
        f"{_brand_context(config)}\n\n"
        f"Write a social media post for {platform.capitalize()}.\n"
        f"{guidance}\n"
        f"{topic_line}"
    )
    return _call(system, user)


def generate_social_captions_batch(
    config: ClientConfig, platform: str, count: int = 4, topics: list[str] | None = None
) -> list[str]:
    """Generate multiple captions in one API call."""
    guidance = PLATFORM_GUIDANCE.get(platform, "")
    topics_line = ""
    if topics:
        topics_line = "Topics to cover (one per post):\n" + "\n".join(f"- {t}" for t in topics)
    else:
        topics_line = f"Choose {count} relevant, varied topics for this brand."

    system = (
        f"You are a marketing copywriter for {config.brand_name}. "
        f"Write in this tone: {config.tone}. "
        f"You are creating content for {config.location.city}, {config.location.state}. "
        "Return ONLY the post copy, numbered 1 through N. No commentary, no labels beyond the number."
    )
    user = (
        f"{_brand_context(config)}\n\n"
        f"Write {count} social media posts for {platform.capitalize()}.\n"
        f"{guidance}\n"
        f"{topics_line}\n\n"
        f"Format: number each post (1., 2., etc.) separated by a blank line."
    )
    raw = _call(system, user)
    return _parse_numbered_list(raw, count)


# ── Blog posts ────────────────────────────────────────────────────────────────

def generate_blog_draft(config: ClientConfig, topic: str | None = None) -> dict:
    """Generate a blog post draft. Returns {title, body}."""
    topic_line = f"Topic: {topic}" if topic else "Choose a relevant, SEO-friendly topic for this brand."

    system = (
        f"You are a content writer for {config.brand_name}, a {config.industry} company "
        f"in {config.location.city}, {config.location.state}. "
        f"Write in this tone: {config.tone}. "
        "Write a complete blog post with a title and body. "
        "Format: first line is the title (no 'Title:' label), then a blank line, then the body. "
        "Body should be 400-600 words, use short paragraphs, no markdown headers."
    )
    user = (
        f"{_brand_context(config)}\n\n"
        f"{topic_line}\n\n"
        "Write the blog post now."
    )
    raw = _call(system, user)
    lines = raw.strip().split("\n", 1)
    title = lines[0].strip()
    body = lines[1].strip() if len(lines) > 1 else ""
    return {"title": title, "body": body}


# ── GBP posts ─────────────────────────────────────────────────────────────────

def generate_gbp_post(config: ClientConfig, topic: str | None = None) -> str:
    """Generate a Google Business Profile post (150-300 words)."""
    topic_line = f"Topic: {topic}" if topic else "Choose a timely, relevant topic for this business."

    system = (
        f"You are writing a Google Business Profile post for {config.brand_name}. "
        f"Tone: {config.tone}. Location: {config.location.city}, {config.location.state}. "
        "Keep it 150-300 words. No hashtags. Include a subtle call to action. "
        "Write only the post copy — no labels, no commentary."
    )
    user = (
        f"{_brand_context(config)}\n\n"
        f"{topic_line}"
    )
    return _call(system, user)


# ── Review responses ──────────────────────────────────────────────────────────

SENTIMENT_GUIDANCE = {
    "positive": (
        "This is a positive review. Thank the reviewer warmly, mention something specific "
        "from their review if possible, and invite them back."
    ),
    "neutral": (
        "This is a neutral review. Acknowledge their feedback, address any concerns briefly, "
        "and invite them to reach out directly if they have questions."
    ),
    "negative": (
        "This is a negative review. Respond professionally and empathetically. "
        "Acknowledge their experience, apologize for any shortcomings, "
        "and invite them to contact you directly to resolve the issue. "
        "Do not be defensive."
    ),
}


def generate_review_response(
    config: ClientConfig,
    review_body: str,
    reviewer_name: str | None,
    rating: int | None,
    sentiment: str = "neutral",
) -> str:
    """Generate a review response draft."""
    name_line = f"Reviewer name: {reviewer_name}" if reviewer_name else "Reviewer name: unknown"
    rating_line = f"Star rating: {rating}/5" if rating else ""
    guidance = SENTIMENT_GUIDANCE.get(sentiment, SENTIMENT_GUIDANCE["neutral"])

    system = (
        f"You are responding to a customer review on behalf of {config.brand_name}. "
        f"Tone: {config.tone}. "
        "Write a professional, genuine response. 2-4 sentences. "
        "Do not use generic filler phrases like 'We value your feedback.' "
        "Write only the response — no labels, no commentary."
    )
    user = (
        f"{_brand_context(config)}\n\n"
        f"{name_line}\n"
        f"{rating_line}\n"
        f"Review: {review_body}\n\n"
        f"{guidance}"
    )
    return _call(system, user)


# ── Utilities ─────────────────────────────────────────────────────────────────

def _parse_numbered_list(text: str, expected: int) -> list[str]:
    """Parse a numbered list response into individual items."""
    import re
    parts = re.split(r"\n\s*\d+\.\s*", text)
    # Remove empty first element if text starts with "1."
    parts = [p.strip() for p in parts if p.strip()]
    return parts[:expected]
