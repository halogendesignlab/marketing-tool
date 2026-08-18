"""content_generator.py — AI content generation via Claude API."""

import anthropic
from .config_loader import ClientConfig
from portal.api.settings import get_settings

settings = get_settings()
_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 1024
MAX_TOKENS_BLOG = 2048


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

def _trim_note(note: str, max_chars: int = 180) -> str:
    """Keyword research notes run long; keep the gist without bloating the prompt."""
    note = " ".join(note.split())
    return note if len(note) <= max_chars else note[:max_chars].rstrip() + "…"

def recent_blog_keywords(db, client_db_id: int, limit: int = 24) -> set[str]:
    """Focus keywords this client's recent blog posts already targeted.

    Recorded on the item when the draft is created, so a later run can pick
    something else rather than rediscovering the same top-volume term.
    """
    from portal.api.models import ContentItem, ContentType

    rows = (
        db.query(ContentItem.meta)
        .filter(
            ContentItem.client_id == client_db_id,
            ContentItem.content_type == ContentType.blog_post,
        )
        .order_by(ContentItem.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        (r[0] or {}).get("focus_keyword", "").lower()
        for r in rows
        if (r[0] or {}).get("focus_keyword")
    }


def pick_blog_keywords(client_id: str, count: int, exclude: set[str] | None = None) -> list[str]:
    """`count` distinct blog keywords, skipping any already used or banned.

    Drawn at random from the strongest candidates rather than taken straight off
    the top of the ranking. Taking the top N is deterministic, and the "already
    used" set is read from existing drafts — so discarding a draft deletes the
    only record that its keyword was tried, and the next run picks it again.
    Discard, regenerate, same two topics, forever.

    Falls back to reusing terms once the research runs dry — a client with three
    usable keywords should still be able to ask for four posts.
    """
    import random

    from .config_loader import load_client_config
    from .keyword_loader import get_blog_keywords

    exclude = {e.lower() for e in (exclude or set())}

    try:
        banned = [b.lower() for b in (load_client_config(client_id).excluded_keywords or [])]
    except Exception:
        banned = []

    ranked = [
        k["keyword"] for k in get_blog_keywords(client_id, max_keywords=40)
        if not any(b in k["keyword"].lower() for b in banned)
    ]

    fresh = [k for k in ranked if k.lower() not in exclude]
    if len(fresh) >= count:
        # Sample from the better end of the list so quality holds, while leaving
        # enough room that two consecutive runs rarely collide.
        pool = fresh[: max(count * 4, 10)]
        return random.sample(pool, count)

    used = [k for k in ranked if k.lower() in exclude]
    return (fresh + used)[:count]


def recent_blog_titles(db, client_db_id: int, limit: int = 12) -> list[str]:
    """Titles of this client's recent blog posts, newest first.

    Feeding these back into the prompt is what stops a monthly cadence from
    circling the same few obvious topics.
    """
    from portal.api.models import ContentItem, ContentType

    rows = (
        db.query(ContentItem.title)
        .filter(
            ContentItem.client_id == client_db_id,
            ContentItem.content_type == ContentType.blog_post,
            ContentItem.title.isnot(None),
        )
        .order_by(ContentItem.created_at.desc())
        .limit(limit)
        .all()
    )
    return [r[0] for r in rows if r[0]]


def generate_blog_draft(
    config: ClientConfig,
    topic: str | None = None,
    recent_titles: list[str] | None = None,
    focus_keyword: str | None = None,
) -> dict:
    """Generate a blog post draft with semantic HTML body. Returns {title, body}.

    `focus_keyword` pins the post to one search term. Listing previous titles and
    asking for something different is a weak guard — it reliably produces a new
    title while staying on the same subject. Handing each post its own keyword
    makes the topics distinct by construction instead.
    """
    from .keyword_loader import get_blog_keywords, get_all_keywords_summary

    if focus_keyword:
        topic_line = (
            f"Primary keyword for this post: \"{focus_keyword}\"\n"
            "Build the post around that search term — it should be the subject of the "
            "article, not a passing mention. Use it in the title where it reads naturally."
        )
        if topic:
            topic_line += f"\nAdditional direction: {topic}"
    elif topic:
        topic_line = f"Topic: {topic}"
    else:
        topic_line = "Choose a relevant, SEO-friendly topic for this brand."

    # Pull keyword context from research CSV if available
    blog_kws = get_blog_keywords(config.client_id, max_keywords=8)
    keyword_context = ""
    if blog_kws:
        kw_lines = "\n".join(
            f"- {k['keyword']} (volume {k['volume']}, priority {k['priority']})"
            + (f"\n  Researcher's note: {_trim_note(k['notes'])}" if k.get("notes") else "")
            for k in blog_kws
        )
        keyword_context = (
            "\n\nWhat this audience searches for, as background on their concerns. "
            "Do NOT try to place these phrases in the text — a search query dropped into a "
            "sentence reads as exactly that. Write about the subject; the words will follow.\n"
            f"{kw_lines}"
        )
    else:
        # Fall back to full summary if no blog-specific keywords
        summary = get_all_keywords_summary(config.client_id)
        if summary:
            keyword_context = f"\n\n{summary}"

    system = (
        f"You write for a trade publication read by people actually planning a "
        f"{config.industry} project in {config.location.city}, {config.location.state}. "
        f"Your readers are intelligent and busy. They are deciding how to spend a lot of money "
        f"and want to understand how something works, not be sold to.\n\n"
        f"Register: {config.tone}. That governs word choice, not content — it is never a licence "
        f"for sentiment or grand statements.\n\n"
        "HOW TO WRITE\n"
        "- Vary sentence length. Follow a long sentence with a short one. Prose where every "
        "sentence runs 20-30 words is exhausting to read.\n"
        "- Open with the most useful thing you have to say. No throat-clearing about how "
        "exciting or important the topic is.\n"
        "- Prefer concrete nouns and strong verbs. Cut adjectives and adverbs that carry no "
        "information: truly, incredibly, exceptional, invaluable, stunning, perfect.\n"
        "- One idea per paragraph. Two to four sentences.\n"
        "- Write things a person would actually say out loud.\n"
        "- Do not address the reader's feelings or describe their dreams.\n"
        "- Do not end with a paragraph that restates what you just said.\n\n"
        "NEVER USE THESE\n"
        "- 'journey', 'dream home', 'vision', 'transform', 'embark', 'unlock', 'elevate'\n"
        "- 'not all X are created equal', 'crystal clear', 'from the ground up', "
        "'turn your aspirations into reality', 'when it comes to', 'in today's world'\n"
        "- Three-part lists as a rhetorical habit: 'listens to your needs, offers guidance, "
        "and delivers results'. Say one thing properly instead.\n"
        "- Bullet points that assert a quality without evidence, like 'transparent communication "
        "throughout every phase'. A bullet must contain information.\n\n"
        "CLAIMS YOU CANNOT MAKE\n"
        "- Never state a dollar amount, price range, or cost per square foot. Not even an "
        "approximate one, and not with a hedge attached. You do not have current pricing, and a "
        "wrong figure published under a builder's name is a correction, not a typo.\n"
        "- The same goes for any statistic you cannot source: percentages, market figures, "
        "permit fees, timelines in weeks or months.\n"
        "- Write about what drives a cost or a timeline instead — the decisions, site conditions "
        "and trade-offs behind it. That is more useful to someone budgeting than a number they "
        "cannot rely on, and it does not go stale.\n"
        "- If a section cannot be written without inventing figures, write a different section.\n\n"
        "FORMAT\n"
        "- Output ONLY the title on the first line (plain text, no HTML tag), then a blank line, "
        "then the HTML body.\n"
        "- Use semantic elements: <h2> for sections, <h3> for sub-headings, <p> for paragraphs, "
        "<ul>/<ol>/<li> for lists.\n"
        "- Do NOT include <html>, <head>, <body>, <h1>, or any outer wrapper tags.\n"
        "- Do NOT use markdown — output real HTML only.\n"
        "- 600-900 words. Three or four <h2> sections.\n"
        "- Headings should say what the section covers, in plain words. Not a search query.\n"
        "- Close with one sentence on what to do next. No hard sell."
    )
    history_context = ""
    if recent_titles:
        titles = "\n".join(f"- {t}" for t in recent_titles)
        history_context = (
            "\n\nAlready published for this brand — do NOT repeat these topics or angles. "
            "Pick a subject that is genuinely distinct, even if it means using a "
            "lower-volume keyword:\n"
            f"{titles}"
        )

    user = (
        f"{_brand_context(config)}"
        f"{keyword_context}"
        f"{history_context}\n\n"
        f"{topic_line}\n\n"
        "Write the blog post now. Remember: first line = plain text title, blank line, then semantic HTML body."
    )

    message = _client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS_BLOG,
        messages=[{"role": "user", "content": user}],
        system=system,
    )
    raw = message.content[0].text.strip()
    lines = raw.split("\n", 1)
    title = lines[0].strip().lstrip("#").strip()   # strip any accidental # the model adds
    body = lines[1].strip() if len(lines) > 1 else ""
    # Remove any accidental markdown code fences
    if body.startswith("```"):
        body = body.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return {"title": title, "body": body}


# ── Blog image selection ──────────────────────────────────────────────────────

def select_blog_images(
    title: str,
    body_excerpt: str,
    project_reps: dict,  # {project_name: MediaItem-like object with .id, .url, .last_used_at}
    count: int = 3,
) -> list:
    """Ask Claude which projects from the media library best illustrate this blog post.

    Returns a list of representative media item objects (one per selected project),
    ordered by relevance. Falls back to LRU order if Claude can't parse a response.
    """
    import json, re

    if not project_reps:
        return []

    # Cap at 60 projects to keep the prompt tight
    project_names = list(project_reps.keys())[:60]

    system = (
        "You are choosing photographs to illustrate a blog post. "
        "From the list of available photo projects, pick the ones whose subject matter "
        "would be most visually relevant and complementary to the article. "
        f"Select exactly {min(count, len(project_names))} project names. "
        'Respond with ONLY a JSON array of project name strings, e.g. ["Project A", "Project B"]. '
        "No explanation, no markdown, just the JSON array."
    )
    user = (
        f"Blog title: {title}\n\n"
        f"Article opening:\n{body_excerpt}\n\n"
        "Available photo projects:\n" + "\n".join(f"- {n}" for n in project_names)
    )

    try:
        message = _client.messages.create(
            model=MODEL,
            max_tokens=200,
            messages=[{"role": "user", "content": user}],
            system=system,
        )
        raw = message.content[0].text.strip()
        match = re.search(r'\[.*?\]', raw, re.DOTALL)
        if match:
            selected_names = json.loads(match.group())
            results = [project_reps[n] for n in selected_names if n in project_reps]
            if results:
                return results
    except Exception:
        pass

    # Fallback: LRU order
    return list(project_reps.values())[:count]


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


# ── Image-based captions (Claude vision) ─────────────────────────────────────

PLATFORM_GUIDANCE_VISION = {
    "instagram": (
        "Instagram caption: visually descriptive, engaging, 1-3 short paragraphs, "
        "3-5 relevant hashtags at the end. Max 2200 chars."
    ),
    "facebook": (
        "Facebook caption: conversational, slightly longer than Instagram, no hashtags, "
        "encourage comments or engagement. Max 500 chars."
    ),
    "linkedin": (
        "LinkedIn caption: professional and business-focused, written for peers and "
        "prospective clients in this company's own industry. No hashtags. Max 400 chars."
    ),
    "gbp": (
        "Google Business Profile post: 150-300 words. No hashtags. "
        "Highlight what's shown, include a subtle call to action."
    ),
}


def generate_captions_from_image(
    config: ClientConfig,
    image_path: str,
    image_filename: str | None = None,
    image_meta: dict | None = None,
) -> dict[str, str]:
    """Analyze an image with Claude vision and return platform-specific captions.

    image_path: local filesystem path or /uploads/... relative URL
    Returns: {"instagram": "...", "facebook": "...", "linkedin": "...", "gbp": "..."}
    """
    import base64
    from pathlib import Path

    UPLOADS_DIR = Path(__file__).parent.parent / "uploads"

    if image_path.startswith("drive://"):
        # Fetch from Google Drive on demand via service account
        from core.drive_watcher import get_file_bytes
        file_id = image_path.removeprefix("drive://")
        image_bytes, media_type = get_file_bytes(file_id)
    elif image_path.startswith("https://") or image_path.startswith("http://"):
        # Fetch from R2 or any public URL
        import httpx
        resp = httpx.get(image_path, timeout=30)
        resp.raise_for_status()
        image_bytes = resp.content
        media_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
    elif image_path.startswith("/uploads/"):
        local = UPLOADS_DIR / image_path.removeprefix("/uploads/")
        image_bytes = local.read_bytes()
        suffix = local.suffix.lower().lstrip(".")
        media_type_map = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp", "gif": "image/gif",
        }
        media_type = media_type_map.get(suffix, "image/jpeg")
    else:
        local = Path(image_path)
        image_bytes = local.read_bytes()
        suffix = local.suffix.lower().lstrip(".")
        media_type_map = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp", "gif": "image/gif",
        }
        media_type = media_type_map.get(suffix, "image/jpeg")
    b64 = base64.standard_b64encode(image_bytes).decode()

    filename_hint = ""
    if image_filename:
        filename_hint = (
            f"\n\nFilename context: \"{image_filename}\" — "
            "the filename may contain an address or location that you can reference in the captions."
        )
    if image_meta:
        parts = []
        if image_meta.get("category"):
            parts.append(f"Category: {image_meta['category']}")
        if image_meta.get("project"):
            parts.append(f"Project/Subdivision: {image_meta['project']}")
        if image_meta.get("photo_type"):
            parts.append(f"Photo type: {image_meta['photo_type']}")
        if parts:
            filename_hint += "\n\nPhoto metadata: " + " | ".join(parts) + \
                ". Reference the project or subdivision name naturally in the captions where appropriate."

    platform_instructions = "\n".join(
        f"{p.upper()}:\n{guidance}"
        for p, guidance in PLATFORM_GUIDANCE_VISION.items()
    )

    system = (
        f"You write social copy for {config.brand_name}, "
        f"a {config.industry} company in {config.location.city}, {config.location.state}.\n\n"
        f"Register: {config.tone}. That governs word choice, not content — it is never a "
        f"licence for sentiment or grand statements.\n\n"
        "THE POST HAS EXACTLY ONE PHOTO — the one attached here.\n"
        "Never write 'swipe', 'swipe to see more', 'tap through', 'photos above', or anything "
        "else implying a carousel or a second image. There is one image and the reader can "
        "already see it.\n\n"
        "HOW TO WRITE\n"
        "- Say something about THIS photo. If the caption would work for any other picture, "
        "it is not finished.\n"
        "- Vary sentence length. Short sentences are allowed and usually better.\n"
        "- Cut adjectives that carry no information: stunning, breathtaking, exceptional, "
        "perfect, gorgeous.\n"
        "- Write things a person would say out loud.\n"
        "- Do not describe the reader's dreams or feelings.\n\n"
        "NEVER USE THESE\n"
        "- 'dream home', 'dream space', 'journey', 'transform', 'bring your vision to life', "
        "'where memories are made', 'elevate', 'nestled'\n"
        "- Three-part lists as a rhetorical habit: 'quality, integrity, and heart'. "
        "Say one thing properly instead.\n"
        "- Rhetorical questions used as an opener.\n\n"
        "Write only the caption copy — no labels, no commentary, no quotation marks."
    )

    user_text = (
        f"{_brand_context(config)}{filename_hint}\n\n"
        f"Write one caption for each platform based on this photo.\n\n"
        f"{platform_instructions}\n\n"
        "Format your response EXACTLY like this (use the label on its own line):\n"
        "INSTAGRAM:\n[caption]\n\nFACEBOOK:\n[caption]\n\nLINKEDIN:\n[caption]\n\nGBP:\n[caption]"
    )

    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": b64,
                    },
                },
                {"type": "text", "text": user_text},
            ],
        }],
        system=system,
    )

    raw = message.content[0].text.strip()
    return _parse_platform_captions(raw)


def _parse_platform_captions(text: str) -> dict[str, str]:
    """Parse the labeled platform caption response."""
    import re
    result: dict[str, str] = {}
    pattern = re.compile(r"(?:^|\n)(INSTAGRAM|FACEBOOK|LINKEDIN|GBP):\n(.*?)(?=\n(?:INSTAGRAM|FACEBOOK|LINKEDIN|GBP):|$)", re.DOTALL)
    for m in pattern.finditer(text):
        key = m.group(1).lower()
        result[key] = m.group(2).strip()
    # Fill any missing platforms with empty string
    for p in ("instagram", "facebook", "linkedin", "gbp"):
        result.setdefault(p, "")
    return result


# ── Utilities ─────────────────────────────────────────────────────────────────

def _parse_numbered_list(text: str, expected: int) -> list[str]:
    """Parse a numbered list response into individual items."""
    import re
    parts = re.split(r"\n\s*\d+\.\s*", text)
    # Remove empty first element if text starts with "1."
    parts = [p.strip() for p in parts if p.strip()]
    return parts[:expected]
