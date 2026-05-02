"""directory_monitor.py — NAP consistency checks via DataForSEO Business Data."""

import httpx
import logging
from .config_loader import ClientConfig
from portal.api.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DATAFORSEO_URL = "https://api.dataforseo.com/v3"


def check_directory_consistency(config: ClientConfig) -> list[dict]:
    """Check business listings against source of truth (NAP) in config."""
    # Source of Truth
    truth = {
        "name": config.brand_name,
        "phone": config.location.phone if hasattr(config.location, "phone") else "",
        "address": f"{config.location.city}, {config.location.state}",
    }

    results = []
    
    # We poll DataForSEO for various directories (Google, Yelp, Bing, etc.)
    # Example logic for checking a list of directories
    for directory in config.directories_to_monitor:
        listing = _fetch_listing(config, directory)
        if not listing:
            continue

        issues = []
        if listing.get("name") != truth["name"]:
            issues.append(f"Name mismatch: '{listing.get('name')}' vs '{truth['name']}'")
        
        # Simple phone check (ignoring formatting for now)
        clean_listing_phone = "".join(filter(str.isdigit, listing.get("phone", "")))
        clean_truth_phone = "".join(filter(str.isdigit, truth["phone"]))
        if clean_listing_phone != clean_truth_phone and truth["phone"]:
            issues.append(f"Phone mismatch: {listing.get('phone')} vs {truth['phone']}")

        results.append({
            "directory": directory,
            "url": listing.get("url"),
            "is_consistent": len(issues) == 0,
            "issues": issues,
            "raw_data": listing
        })

    return results


def _fetch_listing(config: ClientConfig, directory: str) -> dict | None:
    """Fetch a business listing from DataForSEO or direct API."""
    # Placeholder: would call DataForSEO /business_data/<directory>/my_business
    return None
