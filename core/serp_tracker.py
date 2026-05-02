"""serp_tracker.py — Geo-grid rank tracking via DataForSEO SERP API."""

import httpx
import logging
from .config_loader import ClientConfig
from portal.api.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DATAFORSEO_URL = "https://api.dataforseo.com/v3"


def run_geo_grid_scan(config: ClientConfig, keyword: str) -> list[dict]:
    """Trigger a geo-grid SERP scan via DataForSEO."""
    if not config.dataforseo:
        return []

    auth = httpx.BasicAuth(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    
    # DataForSEO Geo-Grid Task structure
    # keyword, location (lat/lng), radius, grid_points
    payload = [
        {
            "keyword": keyword,
            "location_coordinate": f"{config.location.lat},{config.location.lng}",
            "radius": config.dataforseo.grid_radius_km,
            "depth": 20, # Number of search results to check for each point
            "grid_size": f"{config.dataforseo.grid_points}x{config.dataforseo.grid_points}" if hasattr(config.dataforseo, "grid_points") else "5x5",
        }
    ]

    try:
        with httpx.Client(auth=auth, timeout=30) as client:
            # Note: This is an example endpoint
            resp = client.post(f"{DATAFORSEO_URL}/serp/google/local_finder/task_post", json=payload)
            resp.raise_for_status()
            return [] # Returns task ID usually
    except Exception as e:
        logger.error(f"Failed to trigger geo-grid scan for {config.client_id}: {e}")
        return []


def get_grid_results(task_id: str) -> dict:
    """Fetch results for a completed geo-grid scan."""
    # DataForSEO task_get
    return {}
