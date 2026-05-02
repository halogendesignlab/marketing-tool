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

    model_config = {"from_attributes": True}


# ── Clients ───────────────────────────────────────────────────────────────────

class ClientResponse(BaseModel):
    id: int
    client_id: str
    brand_name: str
    industry: str
    location_city: str
    location_state: str
    is_active: bool
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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ApproveContentRequest(BaseModel):
    body: Optional[str] = None       # allow editing body on approval
    scheduled_for: Optional[datetime] = None


class RejectContentRequest(BaseModel):
    reason: Optional[str] = None


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
