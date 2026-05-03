"""publer_publisher.py — Publish content via the Publer API."""

import httpx
from datetime import datetime
from .config_loader import ClientConfig
from portal.api.settings import get_settings

settings = get_settings()

BASE_URL = "https://app.publer.com/api/v1"


def _headers(workspace_id: str) -> dict:
    return {
        "Authorization": f"Bearer-API {settings.PUBLER_API_KEY}",
        "Publer-Workspace-Id": workspace_id,
        "Content-Type": "application/json",
    }


def _auth_headers(workspace_id: str) -> dict:
    """Auth headers without Content-Type (for multipart uploads)."""
    return {
        "Authorization": f"Bearer-API {settings.PUBLER_API_KEY}",
        "Publer-Workspace-Id": workspace_id,
    }


def _account_ids(config: ClientConfig, platforms: list[str]) -> list[str]:
    """Get Publer account IDs for the requested platforms."""
    if not config.publer:
        raise ValueError(f"No Publer config for client {config.client_id}")
    ids = config.publer.social_profile_ids
    result = []
    for p in platforms:
        pid = getattr(ids, p, "")
        if pid:
            result.append(pid)
    return result


def _workspace_id(config: ClientConfig) -> str:
    if not config.publer or not config.publer.workspace_id:
        raise ValueError(f"No Publer workspace_id configured for client {config.client_id}")
    return config.publer.workspace_id


def upload_media(image_url: str, workspace_id: str) -> str:
    """Download an image from a URL and upload it to Publer. Returns the Publer media ID."""
    with httpx.Client(timeout=60) as client:
        # Download the image
        img_resp = client.get(image_url)
        img_resp.raise_for_status()
        image_bytes = img_resp.content
        content_type = img_resp.headers.get("content-type", "image/jpeg")
        filename = image_url.split("/")[-1].split("?")[0] or "image.jpg"

        # Upload to Publer as multipart form
        upload_resp = client.post(
            f"{BASE_URL}/media",
            headers=_auth_headers(workspace_id),
            files={"file": (filename, image_bytes, content_type)},
        )
        upload_resp.raise_for_status()
        data = upload_resp.json()
        return data["id"]


def publish_social_post(
    config: ClientConfig,
    body: str,
    platforms: list[str],
    image_url: str | None = None,
    scheduled_for: datetime | None = None,
    as_draft: bool = True,
) -> dict:
    """Publish or draft a social media post via Publer."""
    account_ids = _account_ids(config, platforms)
    if not account_ids:
        raise ValueError(f"No Publer account IDs found for platforms: {platforms}")

    workspace_id = _workspace_id(config)
    state = "draft" if as_draft else "scheduled"

    accounts_payload = []
    for aid in account_ids:
        entry: dict = {"id": aid}
        if scheduled_for and not as_draft:
            entry["scheduled_at"] = scheduled_for.isoformat()
        accounts_payload.append(entry)

    post: dict = {
        "text": body,
        "accounts": accounts_payload,
    }

    if image_url:
        media_id = upload_media(image_url, workspace_id)
        post["media"] = [{"id": media_id}]

    payload = {
        "bulk": {
            "state": state,
            "posts": [post],
        }
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/posts/schedule",
            headers=_headers(workspace_id),
            json=payload,
        )
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
        as_draft=False,
    )


def upload_gbp_photo(
    config: ClientConfig,
    image_url: str,
    scheduled_for: datetime | None = None,
) -> dict:
    """Upload a photo to Google Business Profile via Publer."""
    if not config.publer:
        raise ValueError(f"No Publer config for client {config.client_id}")

    gbp_id = config.publer.social_profile_ids.gbp
    if not gbp_id:
        raise ValueError(f"No GBP account ID configured for client {config.client_id}")

    workspace_id = _workspace_id(config)
    media_id = upload_media(image_url, workspace_id)

    entry: dict = {"id": gbp_id}
    if scheduled_for:
        entry["scheduled_at"] = scheduled_for.isoformat()

    payload = {
        "bulk": {
            "state": "scheduled",
            "posts": [
                {
                    "text": "",
                    "media": [{"id": media_id}],
                    "accounts": [entry],
                }
            ],
        }
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/posts/schedule",
            headers=_headers(workspace_id),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def get_post_status(job_id: str, workspace_id: str) -> dict:
    """Check the status of a Publer post scheduling job."""
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{BASE_URL}/job_status/{job_id}",
            headers=_auth_headers(workspace_id),
        )
        resp.raise_for_status()
        return resp.json()
