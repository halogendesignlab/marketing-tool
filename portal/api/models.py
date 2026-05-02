"""models.py — SQLAlchemy ORM models for the marketing automation platform."""

import enum
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey, Integer,
    String, Text, Float, JSON
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    admin = "admin"
    client = "client"


class ContentType(str, enum.Enum):
    social_caption = "social_caption"
    blog_post = "blog_post"
    gbp_post = "gbp_post"
    review_response = "review_response"


class ContentStatus(str, enum.Enum):
    pending_approval = "pending_approval"
    approved = "approved"
    rejected = "rejected"
    scheduled = "scheduled"
    published = "published"
    failed = "failed"


class Platform(str, enum.Enum):
    instagram = "instagram"
    facebook = "facebook"
    linkedin = "linkedin"
    gbp = "gbp"
    webflow = "webflow"


class ReviewPlatform(str, enum.Enum):
    google = "google"
    facebook = "facebook"
    yelp = "yelp"
    trustpilot = "trustpilot"
    tripadvisor = "tripadvisor"


class ReviewSentiment(str, enum.Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


# ── Models ────────────────────────────────────────────────────────────────────

class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    brand_name: Mapped[str] = mapped_column(String(200), nullable=False)
    industry: Mapped[str] = mapped_column(String(200))
    tone: Mapped[str] = mapped_column(Text)
    location_city: Mapped[str] = mapped_column(String(100))
    location_state: Mapped[str] = mapped_column(String(50))
    location_lat: Mapped[float] = mapped_column(Float)
    location_lng: Mapped[float] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    users: Mapped[list["User"]] = relationship("User", back_populates="client")
    content_items: Mapped[list["ContentItem"]] = relationship("ContentItem", back_populates="client")
    reviews: Mapped[list["Review"]] = relationship("Review", back_populates="client")
    assets: Mapped[list["Asset"]] = relationship("Asset", back_populates="client")
    reports: Mapped[list["Report"]] = relationship("Report", back_populates="client")
    directory_listings: Mapped[list["DirectoryListing"]] = relationship("DirectoryListing", back_populates="client")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.client)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    client: Mapped["Client | None"] = relationship("Client", back_populates="users")


class ContentItem(Base):
    __tablename__ = "content_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    content_type: Mapped[ContentType] = mapped_column(Enum(ContentType), nullable=False)
    platform: Mapped[Platform | None] = mapped_column(Enum(Platform), nullable=True)
    status: Mapped[ContentStatus] = mapped_column(
        Enum(ContentStatus), default=ContentStatus.pending_approval, index=True
    )

    # Content
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # platform-specific extras

    # Scheduling
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publer_post_id: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Approval
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Failure tracking
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    client: Mapped["Client"] = relationship("Client", back_populates="content_items")
    approved_by: Mapped["User | None"] = relationship("User")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    platform: Mapped[ReviewPlatform] = mapped_column(Enum(ReviewPlatform), nullable=False)
    external_id: Mapped[str] = mapped_column(String(500), nullable=False)  # platform's review ID
    reviewer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    sentiment: Mapped[ReviewSentiment | None] = mapped_column(Enum(ReviewSentiment), nullable=True)
    review_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Response
    response_content_id: Mapped[int | None] = mapped_column(ForeignKey("content_items.id"), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    client: Mapped["Client"] = relationship("Client", back_populates="reviews")
    response_content: Mapped["ContentItem | None"] = relationship("ContentItem")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    drive_file_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    local_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, approved, uploaded
    uploaded_to_gbp: Mapped[bool] = mapped_column(Boolean, default=False)
    gbp_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    client: Mapped["Client"] = relationship("Client", back_populates="assets")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_month: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # all aggregated metrics
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    client: Mapped["Client"] = relationship("Client", back_populates="reports")


class DirectoryListing(Base):
    __tablename__ = "directory_listings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    directory: Mapped[str] = mapped_column(String(100), nullable=False)  # yelp, bbb, etc.
    name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_consistent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)  # list of mismatch descriptions
    last_checked: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    client: Mapped["Client"] = relationship("Client", back_populates="directory_listings")


class SerpResult(Base):
    __tablename__ = "serp_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    keyword: Mapped[str] = mapped_column(String(500), nullable=False)
    grid_data: Mapped[dict] = mapped_column(JSON, nullable=False)  # {lat, lng, rank} per grid point
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_month: Mapped[int] = mapped_column(Integer, nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
