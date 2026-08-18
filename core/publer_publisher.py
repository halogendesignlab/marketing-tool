"""publer_publisher.py — Publish content via the Publer API."""

import json
import logging
import time

import httpx
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .config_loader import ClientConfig
from portal.api.settings import get_settings

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"

settings = get_settings()

logger = logging.getLogger(__name__)

BASE_URL = "https://app.publer.com/api/v1"

# Publer refuses a scheduled_at that has passed by the time it processes the job
# — "Posts cannot be backdated" — so posting now means a moment from now.
POST_NOW_BUFFER = timedelta(minutes=3)

# Maps our platform names to Publer's networks key
NETWORK_KEY = {
    "instagram": "instagram",
    "facebook": "facebook",
    "linkedin": "linkedin",
    "gbp": "google",
}


def _raise_with_body(resp) -> None:
    """raise_for_status, but keep Publer's explanation.

    The bare version discards the response body, which is where Publer puts the
    actual reason — a 400 saying {"errors":["Unknown state auto"]} arrives as a
    generic "Client error '400 Bad Request'" otherwise.
    """
    if resp.is_error:
        raise httpx.HTTPStatusError(
            f"{resp.status_code} from {resp.request.url}: {resp.text[:500]}",
            request=resp.request,
            response=resp,
        )



def _confirm_job(job_id: str, workspace_id: str, attempts: int = 7, delay: float = 4.0) -> None:
    """Wait for a scheduling job and raise if Publer rejected the post.

    /posts/schedule returns 200 with a job id as soon as the request is accepted;
    whether the post was actually taken is only reported by job_status. Without
    this, a rejected post is indistinguishable from a published one — the caller
    sees 200 and records success.

    Still processing after the last attempt is not treated as failure: it usually
    means Publer is slow, and marking it failed would be its own wrong answer.
    """
    for _ in range(attempts):
        time.sleep(delay)
        status = get_post_status(job_id, workspace_id)
        state = status.get("status")

        if state in ("complete", "completed"):
            failures = (status.get("payload") or {}).get("failures") or {}
            messages = [
                f"{f.get('account_name') or f.get('account_id')}: {f.get('message')}"
                for entries in failures.values()
                for f in entries
            ]
            if messages:
                raise RuntimeError("Publer rejected the post — " + "; ".join(messages))
            return

        if state in ("failed", "error"):
            raise RuntimeError(f"Publer job {job_id} failed: {json.dumps(status)[:300]}")

    logger.warning("Publer job %s still processing after %ss — not confirmed", job_id, attempts * delay)


def _headers(workspace_id: str) -> dict:
    return {
        "Authorization": f"Bearer-API {settings.PUBLER_API_KEY}",
        "Publer-Workspace-Id": workspace_id,
        "Content-Type": "application/json",
    }


def _auth_headers(workspace_id: str) -> dict:
    return {
        "Authorization": f"Bearer-API {settings.PUBLER_API_KEY}",
        "Publer-Workspace-Id": workspace_id,
    }


def _account_ids(config: ClientConfig, platforms: list[str]) -> list[str]:
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


def upload_media(image_url: str, workspace_id: str) -> dict:
    """Upload an image to Publer. Accepts a full URL or a relative /uploads/ path.
    Returns the media object {"id": ..., "type": "photo"}."""
    if image_url.startswith("/uploads/"):
        local_path = UPLOADS_DIR / image_url.removeprefix("/uploads/")
        image_bytes = local_path.read_bytes()
        filename = local_path.name
        suffix = local_path.suffix.lower().lstrip(".")
        content_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                        "webp": "image/webp", "gif": "image/gif"}.get(suffix, "image/jpeg")
    else:
        with httpx.Client(timeout=60) as client:
            img_resp = client.get(image_url)
            img_resp.raise_for_status()
            image_bytes = img_resp.content
            content_type = img_resp.headers.get("content-type", "image/jpeg")
            filename = image_url.split("/")[-1].split("?")[0] or "image.jpg"

    with httpx.Client(timeout=60) as client:
        upload_resp = client.post(
            f"{BASE_URL}/media",
            headers=_auth_headers(workspace_id),
            files={"file": (filename, image_bytes, content_type)},
        )
        _raise_with_body(upload_resp)
        data = upload_resp.json()
        return {"id": data["id"], "type": data.get("type", "photo")}


def publish_social_post(
    config: ClientConfig,
    body: str,
    platforms: list[str],
    image_url: str | None = None,
    scheduled_for: datetime | None = None,
    as_draft: bool = False,
) -> dict:
    """Publish or draft a social media post via Publer."""
    account_ids = _account_ids(config, platforms)
    if not account_ids:
        raise ValueError(f"No Publer account IDs found for platforms: {platforms}")

    workspace_id = _workspace_id(config)

    # Publer accepts draft, scheduled and recurring. "auto" was rejected outright
    # with {"errors":["Unknown state auto"]}, so a post approved without a date
    # never published — posting now is expressed as scheduled for this moment.
    state = "draft" if as_draft else "scheduled"
    publish_at = scheduled_for or (datetime.now(timezone.utc) + POST_NOW_BUFFER)

    # Upload media once and reuse across all platforms
    media_obj = None
    if image_url:
        media_obj = upload_media(image_url, workspace_id)

    accounts_payload = []
    for aid in account_ids:
        entry: dict = {"id": aid}
        if not as_draft:
            entry["scheduled_at"] = publish_at.isoformat()
        accounts_payload.append(entry)

    # Build the networks object — text and media must live inside each network key
    networks: dict = {}
    for platform in platforms:
        net_key = NETWORK_KEY.get(platform, platform)
        net: dict = {"type": "photo" if media_obj else "status", "text": body}
        if media_obj:
            net["media"] = [media_obj]
        networks[net_key] = net

    payload = {
        "bulk": {
            "state": state,
            "posts": [{"networks": networks, "accounts": accounts_payload}],
        }
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/posts/schedule",
            headers=_headers(workspace_id),
            json=payload,
        )
        _raise_with_body(resp)
        result = resp.json()

    # 200 only means queued. Confirm before the caller records a success.
    if not as_draft and result.get("job_id"):
        _confirm_job(result["job_id"], workspace_id)
    return result


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
    description: str = "",
) -> dict:
    """Add a photo to the Google Business Profile photo gallery.

    This is the gallery, not the Updates feed. The two are different surfaces on
    the profile and Publer tells them apart by details.type — without it the same
    payload posts an Update instead, which is what this function used to do.

    `description` is optional; Google shows it as the photo's description.
    """
    if not config.publer:
        raise ValueError(f"No Publer config for client {config.client_id}")

    gbp_id = config.publer.social_profile_ids.gbp
    if not gbp_id:
        raise ValueError(f"No GBP account ID configured for client {config.client_id}")

    workspace_id = _workspace_id(config)
    media_obj = upload_media(image_url, workspace_id)

    # See publish_social_post: "auto" is not a state Publer accepts. Uploading now
    # is expressed as scheduled for this moment.
    publish_at = scheduled_for or (datetime.now(timezone.utc) + POST_NOW_BUFFER)
    entry: dict = {"id": gbp_id, "scheduled_at": publish_at.isoformat()}

    payload = {
        "bulk": {
            "state": "scheduled",
            "posts": [{
                "networks": {
                    "google": {
                        "type": "photo",
                        "details": {"type": "photo"},
                        "text": description,
                        "media": [media_obj],
                    }
                },
                "accounts": [entry],
            }],
        }
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/posts/schedule",
            headers=_headers(workspace_id),
            json=payload,
        )
        _raise_with_body(resp)
        result = resp.json()

    if result.get("job_id"):
        _confirm_job(result["job_id"], workspace_id)
    return result


def get_post_status(job_id: str, workspace_id: str) -> dict:
    """Check the status of a Publer post scheduling job."""
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{BASE_URL}/job_status/{job_id}",
            headers=_auth_headers(workspace_id),
        )
        _raise_with_body(resp)
        return resp.json()
