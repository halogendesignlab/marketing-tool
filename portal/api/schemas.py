"""schemas.py — Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr

from .models import ContentType, ContentStatus, Platform, UserRole, ReviewPlatform, ReviewSentiment


# ── Auth ──────────────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: UserRole
    client_id: Optional[int]
    client_ids: list[int] = []

    model_config = {"from_attributes": True}


class UserWithClientResponse(BaseModel):
    id: int
    email: str
    name: str
    role: UserRole
    client_id: Optional[int]
    client_name: Optional[str]
    client_ids: list[int] = []
    client_names: list[str] = []
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]

    model_config = {"from_attributes": True}


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[UserRole] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    client_ids: Optional[list[int]] = None


# ── Clients ───────────────────────────────────────────────────────────────────

class ClientResponse(BaseModel):
    id: int
    client_id: str
    brand_name: str
    industry: str
    location_city: str
    location_state: str
    is_active: bool
    media_source_client_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Content ───────────────────────────────────────────────────────────────────

class ContentItemResponse(BaseModel):
    id: int
    client_id: int
    content_type: ContentType
    platform: Optional[Platform]
    status: ContentStatus
    title: Optional[str]
    body: str
    image_url: Optional[str]
    scheduled_for: Optional[datetime]
    published_at: Optional[datetime]
    rejection_reason: Optional[str] = None
    meta: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ApproveContentRequest(BaseModel):
    body: Optional[str] = None
    image_url: Optional[str] = None
    scheduled_for: Optional[datetime] = None


class RejectContentRequest(BaseModel):
    reason: Optional[str] = None


class GenerateDraftRequest(BaseModel):
    content_type: str          # social_caption | blog_post | gbp_post
    platform: Optional[str] = None          # legacy single-platform
    platforms: Optional[list[str]] = None   # multi-platform: ["instagram", "facebook", ...]
    media_item_id: Optional[int] = None
    topic: Optional[str] = None
    client_id: Optional[int] = None  # admin override


# ── Assets ────────────────────────────────────────────────────────────────────

class AssetResponse(BaseModel):
    id: int
    client_id: int
    filename: str
    status: str
    uploaded_to_gbp: bool
    detected_at: datetime

    model_config = {"from_attributes": True}


# ── Reviews ───────────────────────────────────────────────────────────────────

class ReviewResponse(BaseModel):
    id: int
    client_id: int
    platform: ReviewPlatform
    reviewer_name: Optional[str]
    rating: Optional[int]
    body: Optional[str]
    sentiment: Optional[ReviewSentiment]
    review_date: Optional[datetime]
    responded_at: Optional[datetime]
    detected_at: datetime

    model_config = {"from_attributes": True}


# ── Reports ───────────────────────────────────────────────────────────────────

class ReportResponse(BaseModel):
    id: int
    client_id: int
    period_year: int
    period_month: int
    data: dict
    generated_at: datetime

    model_config = {"from_attributes": True}


# ── Directory ─────────────────────────────────────────────────────────────────

class DirectoryListingResponse(BaseModel):
    id: int
    client_id: int
    directory: str
    name: Optional[str]
    address: Optional[str]
    phone: Optional[str]
    is_consistent: Optional[bool]
    issues: Optional[list]
    last_checked: Optional[datetime]

    model_config = {"from_attributes": True}


# ── Client admin ─────────────────────────────────────────────────────────────

class CreateClientRequest(BaseModel):
    client_id: str
    brand_name: str
    industry: str
    tone: str
    location_city: str
    location_state: str
    location_lat: float
    location_lng: float
    # Publer
    publer_workspace_id: str = ""
    publer_instagram_id: str = ""
    publer_facebook_id: str = ""
    publer_linkedin_id: str = ""
    publer_gbp_id: str = ""
    # GBP
    gbp_location_id: str = ""
    gbp_account_id: str = ""
    gbp_credentials_file: str = ""
    # Local Falcon (SERP grids)
    local_falcon_api_key: str = ""
    local_falcon_place_id: str = ""
    # Schedule
    social_posts_per_month: int = 12
    blog_posts_per_month: int = 1
    gbp_posts_per_month: int = 4
    gbp_image_uploads_per_week: int = 1
    report_day_of_month: int = 1
    serp_check_day_of_month: int = 1
    review_check_interval_hours: int = 24
    directory_check_day_of_month: int = 15
    # Directories
    directories_to_monitor: list[str] = ["google", "yelp", "bbb", "yellowpages", "bing"]
    # Google Drive
    drive_folder_id: str = ""
    # Notifications
    client_email: str = ""
    admin_email: str = ""
    # Shared media
    media_source_client_id: Optional[int] = None


class UpdateClientRequest(BaseModel):
    brand_name: Optional[str] = None
    industry: Optional[str] = None
    tone: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    publer_workspace_id: Optional[str] = None
    publer_instagram_id: Optional[str] = None
    publer_facebook_id: Optional[str] = None
    publer_linkedin_id: Optional[str] = None
    publer_gbp_id: Optional[str] = None
    gbp_location_id: Optional[str] = None
    gbp_account_id: Optional[str] = None
    gbp_credentials_file: Optional[str] = None
    local_falcon_api_key: Optional[str] = None
    local_falcon_place_id: Optional[str] = None
    social_posts_per_month: Optional[int] = None
    blog_posts_per_month: Optional[int] = None
    gbp_posts_per_month: Optional[int] = None
    gbp_image_uploads_per_week: Optional[int] = None
    report_day_of_month: Optional[int] = None
    serp_check_day_of_month: Optional[int] = None
    review_check_interval_hours: Optional[int] = None
    directory_check_day_of_month: Optional[int] = None
    directories_to_monitor: Optional[list[str]] = None
    drive_folder_id: Optional[str] = None
    client_email: Optional[str] = None
    admin_email: Optional[str] = None
    is_active: Optional[bool] = None
    media_source_client_id: Optional[int] = None


class ClientDetailResponse(BaseModel):
    id: int
    client_id: str
    brand_name: str
    industry: str
    tone: str
    location_city: str
    location_state: str
    location_lat: float
    location_lng: float
    is_active: bool
    created_at: datetime
    publer_workspace_id: str
    publer_instagram_id: str
    publer_facebook_id: str
    publer_linkedin_id: str
    publer_gbp_id: str
    gbp_location_id: str
    gbp_account_id: str
    gbp_credentials_file: str
    local_falcon_api_key: str = ""
    local_falcon_place_id: str = ""
    social_posts_per_month: int
    blog_posts_per_month: int
    gbp_posts_per_month: int
    gbp_image_uploads_per_week: int
    report_day_of_month: int
    serp_check_day_of_month: int
    review_check_interval_hours: int
    directory_check_day_of_month: int
    directories_to_monitor: list[str]
    drive_folder_id: str
    client_email: str
    admin_email: str
    media_source_client_id: Optional[int] = None
    users: list[UserResponse]

    model_config = {"from_attributes": True}


class InviteUserRequest(BaseModel):
    email: str
    name: str
    role: UserRole = UserRole.client
    password: str


# ── Media Library ─────────────────────────────────────────────────────────────

class CreateFolderRequest(BaseModel):
    name: str
    parent_id: Optional[int] = None


class MediaFolderResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    children: list["MediaFolderResponse"] = []
    item_count: int = 0

    model_config = {"from_attributes": True}


MediaFolderResponse.model_rebuild()


class MediaItemResponse(BaseModel):
    id: int
    client_id: int
    folder_id: Optional[int]
    filename: str
    url: str
    mime_type: str
    size: int
    last_used_at: Optional[datetime]
    created_at: datetime
    meta: Optional[dict] = None

    model_config = {"from_attributes": True}


class MoveItemRequest(BaseModel):
    folder_id: Optional[int] = None


# ── Client Files ──────────────────────────────────────────────────────────────

class ClientFileResponse(BaseModel):
    id: int
    client_id: int
    filename: str
    mime_type: str
    size: int
    description: str | None
    created_at: datetime

    class Config:
        from_attributes = True
