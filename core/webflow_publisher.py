"""webflow_publisher.py — Publish blog posts to Webflow CMS."""

import httpx
from datetime import datetime, timezone
from .config_loader import ClientConfig

WEBFLOW_BASE = "https://api.webflow.com/v2"


def _headers(api_token: str) -> dict:
    return {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "accept-version": "1.0.0",
    }


def publish_blog_post(
    config: ClientConfig,
    title: str,
    body: str,
    slug: str | None = None,
    publish_immediately: bool = False,
) -> dict:
    """Create a blog post in Webflow CMS and optionally publish it."""
    if not config.webflow:
        raise ValueError(f"No Webflow config for client {config.client_id}")

    wf = config.webflow
    headers = _headers(wf.api_token)

    # Generate slug from title if not provided
    if not slug:
        from python_slugify import slugify
        slug = slugify(title)

    # Create the CMS item
    payload = {
        "isArchived": False,
        "isDraft": not publish_immediately,
        "fieldData": {
            "name": title,
            "slug": slug,
            "post-body": body,
            "post-summary": body[:200] + "..." if len(body) > 200 else body,
            "published-on": datetime.now(timezone.utc).isoformat(),
        },
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{WEBFLOW_BASE}/collections/{wf.blog_collection_id}/items",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        item = resp.json()

    # Publish the item if requested
    if publish_immediately:
        item_id = item.get("id")
        _publish_item(wf.site_id, wf.blog_collection_id, item_id, wf.api_token)

    return item


def _publish_item(site_id: str, collection_id: str, item_id: str, api_token: str) -> None:
    """Publish a Webflow CMS item."""
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{WEBFLOW_BASE}/collections/{collection_id}/items/publish",
            headers=_headers(api_token),
            json={"itemIds": [item_id]},
        )
        resp.raise_for_status()
