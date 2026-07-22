"""review_monitor.py — Review monitoring via DataForSEO Business Data API."""

import time
import logging
import httpx
from .config_loader import ClientConfig
from portal.api.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

BASE_URL = "https://api.dataforseo.com/v3"
REVIEWS_PER_CHECK = 20


def _auth() -> httpx.BasicAuth:
    return httpx.BasicAuth(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)


def _location_name(config: ClientConfig) -> str:
    return f"{config.location.city},{config.location.state},United States"


def _post_task(endpoint: str, payload: dict) -> str | None:
    """Post a single DataForSEO task and return the task ID."""
    try:
        with httpx.Client(auth=_auth(), timeout=30) as client:
            resp = client.post(f"{BASE_URL}/{endpoint}", json=[payload])
            resp.raise_for_status()
            data = resp.json()
        task = (data.get("tasks") or [{}])[0]
        if task.get("status_code") == 20100:
            return task["id"]
        logger.warning(f"DataForSEO task rejected ({endpoint}): {task.get('status_message')}")
    except Exception as e:
        logger.error(f"DataForSEO task post failed ({endpoint}): {e}")
    return None


def _fetch_task(endpoint: str, task_id: str, retries: int = 6, delay: int = 10) -> dict | None:
    """Poll DataForSEO until a task result is ready."""
    try:
        with httpx.Client(auth=_auth(), timeout=30) as client:
            for _ in range(retries):
                resp = client.get(f"{BASE_URL}/{endpoint}/{task_id}")
                resp.raise_for_status()
                data = resp.json()
                task = (data.get("tasks") or [{}])[0]
                if task.get("status_code") == 20000:
                    return task
                time.sleep(delay)
    except Exception as e:
        logger.error(f"DataForSEO task fetch failed ({endpoint}/{task_id}): {e}")
    return None


# ── Google reviews ────────────────────────────────────────────────────────────

def fetch_google_reviews(config: ClientConfig) -> list[dict]:
    """Fetch recent Google reviews for the business via DataForSEO."""
    if not settings.DATAFORSEO_LOGIN:
        return []

    task_id = _post_task("business_data/google/reviews/task_post", {
        "keyword": config.brand_name,
        "location_name": _location_name(config),
        "language_code": "en",
        "depth": REVIEWS_PER_CHECK,
        "sort_by": "newest",
    })
    if not task_id:
        return []

    time.sleep(10)
    result = _fetch_task("business_data/google/reviews/task_get", task_id)
    if not result:
        return []

    reviews = []
    try:
        items = result["result"][0].get("items") or []
        for item in items:
            reviews.append({
                "platform": "google",
                "external_id": f"google_{item.get('review_id', '')}",
                "reviewer_name": item.get("profile_name") or item.get("reviewer_name"),
                "rating": item.get("rating", {}).get("value") if isinstance(item.get("rating"), dict) else item.get("rating"),
                "body": item.get("review_text") or item.get("text"),
                "review_date": item.get("timestamp"),
                "has_owner_response": bool(item.get("owner_answer")),
            })
    except (KeyError, IndexError, TypeError) as e:
        logger.warning(f"[{config.client_id}] Error parsing Google reviews: {e}")

    return reviews


# ── Yelp reviews ──────────────────────────────────────────────────────────────

def fetch_yelp_reviews(config: ClientConfig) -> list[dict]:
    """Fetch recent Yelp reviews for the business via DataForSEO."""
    if not settings.DATAFORSEO_LOGIN:
        return []

    task_id = _post_task("business_data/yelp/reviews/task_post", {
        "keyword": config.brand_name,
        "location_name": f"{config.location.city}, {config.location.state}",
        "language_code": "en",
        "depth": REVIEWS_PER_CHECK,
        "sort_by": "date",
    })
    if not task_id:
        return []

    time.sleep(10)
    result = _fetch_task("business_data/yelp/reviews/task_get", task_id)
    if not result:
        return []

    reviews = []
    try:
        items = result["result"][0].get("items") or []
        for item in items:
            reviews.append({
                "platform": "yelp",
                "external_id": f"yelp_{item.get('review_id', '')}",
                "reviewer_name": item.get("user_name") or item.get("profile_name"),
                "rating": item.get("rating"),
                "body": item.get("review_text") or item.get("text"),
                "review_date": item.get("time_value") or item.get("timestamp"),
                "has_owner_response": bool(item.get("owner_reply") or item.get("owner_answer")),
            })
    except (KeyError, IndexError, TypeError) as e:
        logger.warning(f"[{config.client_id}] Error parsing Yelp reviews: {e}")

    return reviews


# ── Aggregator ────────────────────────────────────────────────────────────────

def fetch_all_reviews(config: ClientConfig) -> list[dict]:
    """Fetch all recent reviews from Google and Yelp with owner response status."""
    return fetch_google_reviews(config) + fetch_yelp_reviews(config)
