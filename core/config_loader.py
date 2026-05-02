"""config_loader.py - Load and validate per-client config.json files.

Each client lives in clients/<client_id>/config.json.
Call load_client_config(client_id) to get a validated ClientConfig object.
"""

import json
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator


# ── Sub-models ────────────────────────────────────────────────────────────────

class LocationConfig(BaseModel):
    city: str
    state: str
    lat: float
    lng: float


class SocialPlatformConfig(BaseModel):
    account_id: str = ""
    access_token: str = ""


class SocialConfig(BaseModel):
    instagram: SocialPlatformConfig = SocialPlatformConfig()
    facebook: SocialPlatformConfig = SocialPlatformConfig()
    linkedin: SocialPlatformConfig = SocialPlatformConfig()


class PublerProfileIds(BaseModel):
    instagram: str = ""
    facebook: str = ""
    linkedin: str = ""
    gbp: str = ""


class PublerConfig(BaseModel):
    workspace_id: str
    social_profile_ids: PublerProfileIds = PublerProfileIds()


class GBPConfig(BaseModel):
    location_id: str
    account_id: str
    google_credentials_file: str


class WebflowConfig(BaseModel):
    site_id: str
    blog_collection_id: str
    api_token: str


class DriveConfig(BaseModel):
    asset_folder_id: str


class DataForSEOConfig(BaseModel):
    serp_keywords: list[str] = []
    grid_radius_km: int = 15
    grid_points: int = 25


class ScheduleConfig(BaseModel):
    social_posts_per_month: int = 12
    blog_posts_per_month: int = 1
    gbp_posts_per_month: int = 4
    gbp_image_uploads_per_week: int = 1
    report_day_of_month: int = 1
    review_check_interval_hours: int = 24
    directory_check_day_of_month: int = 15
    serp_check_day_of_month: int = 1


class NotificationsConfig(BaseModel):
    client_email: str
    admin_email: str


class PortalUser(BaseModel):
    email: str
    role: str  # "client" or "admin"
    name: str


# ── Root config model ─────────────────────────────────────────────────────────

class ClientConfig(BaseModel):
    client_id: str
    brand_name: str
    industry: str
    tone: str
    location: LocationConfig
    social: SocialConfig = SocialConfig()
    publer: Optional[PublerConfig] = None
    gbp: Optional[GBPConfig] = None
    webflow: Optional[WebflowConfig] = None
    drive: Optional[DriveConfig] = None
    dataforseo: DataForSEOConfig = DataForSEOConfig()
    directories_to_monitor: list[str] = ["google", "yelp", "bbb", "yellowpages", "bing"]
    schedule: ScheduleConfig = ScheduleConfig()
    notifications: NotificationsConfig
    portal_users: list[PortalUser] = []

    @field_validator("client_id")
    @classmethod
    def client_id_slug(cls, v: str) -> str:
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("client_id must be alphanumeric with underscores/hyphens only")
        return v


# ── Loader ────────────────────────────────────────────────────────────────────

CLIENTS_DIR = Path(__file__).parent.parent / "clients"


def load_client_config(client_id: str) -> ClientConfig:
    """Load and validate a client config by client_id."""
    config_path = CLIENTS_DIR / client_id / "config.json"

    if not config_path.exists():
        raise FileNotFoundError(
            f"No config found for client '{client_id}'. "
            f"Expected: {config_path}"
        )

    with open(config_path) as f:
        raw = json.load(f)

    return ClientConfig(**raw)


def list_clients() -> list[str]:
    """Return all configured client IDs."""
    if not CLIENTS_DIR.exists():
        return []
    return [
        d.name for d in CLIENTS_DIR.iterdir()
        if d.is_dir() and (d / "config.json").exists()
    ]


def load_all_clients() -> list[ClientConfig]:
    """Load all client configs."""
    return [load_client_config(cid) for cid in list_clients()]
