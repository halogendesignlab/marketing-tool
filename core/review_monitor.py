"""review_monitor.py — Cross-platform review aggregation via DataForSEO + Meta + Yelp."""

import httpx
import logging
from .config_loader import ClientConfig
from portal.api.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DATAFORSEO_URL = "https://api.dataforseo.com/v3"


def fetch_google_reviews(config: ClientConfig) -> list[dict]:
    """Fetch reviews for a Google Business Profile via DataForSEO."""
    if not config.gbp or not config.gbp.location_id:
        return []

    # Format: DataForSEO Business Data API
    # Note: Real implementation would use the location_id or search string
    # For now, this is a skeleton for the API call structure.
    
    auth = httpx.BasicAuth(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    payload = [
        {
            "location_id": config.gbp.location_id,
            "limit": 10,
            "sort_by": "newest"
        }
    ]

    try:
        with httpx.Client(auth=auth, timeout=30) as client:
            # Note: This is an example endpoint; exact DataForSEO paths vary by task type
            resp = client.post(f"{DATAFORSEO_URL}/business_data/google/reviews/task_post", json=payload)
            resp.raise_for_status()
            # In DataForSEO, you typically post a task and then get results via task_get or webhook
            return []  # Return empty for now as we need real task management
    except Exception as e:
        logger.error(f"Failed to fetch Google reviews for {config.client_id}: {e}")
        return []


def fetch_meta_reviews(config: ClientConfig) -> list[dict]:
    """Fetch Facebook/Meta reviews/recommendations."""
    if not config.social or not config.social.facebook or not config.social.facebook.page_id:
        return []

    token = config.social.facebook.access_token
    page_id = config.social.facebook.page_id
    url = f"https://graph.facebook.com/v19.0/{page_id}/ratings"

    params = {
        "access_token": token,
        "fields": "created_time,review_text,rating,reviewer"
    }

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", [])
    except Exception as e:
        logger.error(f"Failed to fetch Meta reviews for {config.client_id}: {e}")
        return []


def fetch_yelp_reviews(config: ClientConfig) -> list[dict]:
    """Fetch Yelp reviews via Yelp Fusion API."""
    # Note: Needs a Yelp API Key (can be added to settings/env)
    # Placeholder for now
    return []


def aggregate_new_reviews(config: ClientConfig, known_review_ids: set[str]) -> list[dict]:
    """Fetch reviews from all platforms and filter for new ones."""
    all_reviews = []
    
    google = fetch_google_reviews(config)
    # Transform to common format
    for r in google:
        rid = f"google_{r.get('review_id')}"
        if rid not in known_review_ids:
            all_reviews.append({
                "platform": "google",
                "review_id": rid,
                "body": r.get("text"),
                "reviewer": r.get("reviewer_name"),
                "rating": r.get("rating"),
                "detected_at_raw": r.get("time_published"),
            })

    meta = fetch_meta_reviews(config)
    for r in meta:
        rid = f"meta_{r.get('id')}"
        if rid not in known_review_ids:
            all_reviews.append({
                "platform": "facebook",
                "review_id": rid,
                "body": r.get("review_text"),
                "reviewer": r.get("reviewer", {}).get("name"),
                "rating": r.get("rating"),
                "detected_at_raw": r.get("created_time"),
            })

    return all_reviews
