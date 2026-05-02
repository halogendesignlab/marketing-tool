"""publer_publisher.py — Publish content via the Publer API."""

import httpx
from datetime import datetime
from .config_loader import ClientConfig
from portal.api.settings import get_settings

settings = get_settings()

BASE_URL = "https://api.publer.io/v1"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.PUBLER_API_KEY}",
        "Content-Type": "application/json",
    }


def _profile_ids(config: ClientConfig, platforms: list[str]) -> list[str]:
    """Get Publer profile IDs for the requested platforms."""
    if not config.publer:
        raise ValueError(f"No Publer config for client {config.client_id}")
    ids = config.publer.social_profile_ids
    result = []
    for p in platforms:
        pid = getattr(ids, p, "")
        if pid:
            result.append(pid)
    return result


def publish_social_post(
    config: ClientConfig,
    body: str,
    platforms: list[str],
    image_url: str | None = None,
    scheduled_for: datetime | None = None,
) -> dict:
    """Publish a social media post to one or more platforms via Publer."""
    profile_ids = _profile_ids(config, platforms)
    if not profile_ids:
        raise ValueError(f"No Publer profile IDs found for platforms: {platforms}")

    payload: dict = {
        "profile_ids": profile_ids,
        "text": body,
    }

    if image_url:
        payload["media"] = [{"url": image_url}]

    if scheduled_for:
        payload["scheduled_at"] = scheduled_for.isoformat()

    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{BASE_URL}/posts", headers=_headers(), json=payload)
        resp.raise_for_status()
        return resp.json()


def publish_gbp_post(
    config: ClientConfig,
    body: str,
    image_url: str | None = None,
    scheduled_for: datetime | None = None,
) -> dict:
    """Publish a Google Business Profile post via Publer."""
    return publish_social_post(
        config=config,
        body=body,
        platforms=["gbp"],
        image_url=image_url,
        scheduled_for=scheduled_for,
    )


def upload_gbp_photo(
    config: ClientConfig,
    image_url: str,
    scheduled_for: datetime | None = None,
) -> dict:
    """Upload a photo to Google Business Profile via Publer."""
    if not config.publer:
        raise ValueError(f"No Publer config for client {config.client_id}")

    gbp_profile_id = config.publer.social_profile_ids.gbp
    if not gbp_profile_id:
        raise ValueError(f"No GBP profile ID configured for client {config.client_id}")

    payload: dict = {
        "profile_ids": [gbp_profile_id],
        "text": "",  # photo-only post
        "media": [{"url": image_url}],
    }

    if scheduled_for:
        payload["scheduled_at"] = scheduled_for.isoformat()

    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{BASE_URL}/posts", headers=_headers(), json=payload)
        resp.raise_for_status()
        return resp.json()


def get_post_status(publer_post_id: str) -> dict:
    """Check the status of a scheduled/published Publer post."""
    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{BASE_URL}/posts/{publer_post_id}", headers=_headers())
        resp.raise_for_status()
        return resp.json()
