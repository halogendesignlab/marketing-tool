"""routes/approvals.py — Approve, edit, or reject content items."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ContentItem, ContentStatus, ContentType, User
from ..auth import get_current_user
from ..schemas import (
    ContentItemResponse, ApproveContentRequest, RejectContentRequest,
    GenerateDraftRequest, PublishedItemResponse, UpdateContentRequest,
    GenerateBatchRequest, GenerateBatchResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Days a client has to review a blog post before it publishes on its own.
BLOG_REVIEW_WINDOW_DAYS = 7

# How many photos a blog draft carries. One, so the post has a lead image and
# nothing else competing with the text.
BLOG_IMAGE_COUNT = 1


def _as_utc(dt: datetime | None) -> datetime | None:
    """Read a stored timestamp as UTC-aware.

    Postgres hands back aware datetimes for these columns; SQLite hands back
    naive ones regardless of timezone=True. Comparing a naive value against an
    aware now() raises TypeError, so anything read off an item gets normalised
    before it is compared.
    """
    if dt is None or dt.tzinfo is not None:
        return dt
    return dt.replace(tzinfo=timezone.utc)

# What a client sees in their feed. Approved/scheduled items stay listed so the
# decision is visible and reversible right up until the item actually goes live.
CLIENT_VISIBLE_STATUSES = (
    ContentStatus.client_review,
    ContentStatus.approved,
    ContentStatus.scheduled,
)

# Statuses a client may pull back to their own review queue.
UNDOABLE_STATUSES = (ContentStatus.approved, ContentStatus.scheduled)


@router.post("/generate", response_model=ContentItemResponse)
def generate_draft(
    req: GenerateDraftRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a content draft on demand and save it as pending_approval."""
    from core.config_loader import load_client_config
    from core.content_generator import (
        generate_captions_from_image, generate_blog_draft, generate_gbp_post,
        recent_blog_titles,
    )
    from ..models import Client, MediaItem, ContentType, Platform

    # Resolve client
    if current_user.role == "admin" and req.client_id:
        client_db_id = req.client_id
    elif current_user.client_id:
        client_db_id = current_user.client_id
    else:
        raise HTTPException(status_code=400, detail="No client context")

    client_row = db.query(Client).filter(Client.id == client_db_id).first()
    if not client_row:
        raise HTTPException(status_code=404, detail="Client not found")

    config = load_client_config(client_row.client_id)

    if req.content_type == "social_caption":
        if not req.media_item_id:
            raise HTTPException(status_code=400, detail="media_item_id required for social captions")
        # Also allow items from the shared media source client (if this client delegates its library)
        allowed_client_ids = {client_db_id}
        if client_row.media_source_client_id:
            allowed_client_ids.add(client_row.media_source_client_id)
        media_item = db.query(MediaItem).filter(
            MediaItem.id == req.media_item_id,
            MediaItem.client_id.in_(allowed_client_ids),
        ).first()
        if not media_item:
            raise HTTPException(status_code=404, detail="Media item not found")

        captions = generate_captions_from_image(
            config=config,
            image_path=media_item.url,
            image_filename=media_item.filename,
            image_meta=media_item.meta,
        )

        # Resolve platform list — prefer req.platforms, fall back to req.platform
        selected_platforms: list[str] = req.platforms or ([req.platform] if req.platform else ["instagram"])
        selected_platforms = [p for p in selected_platforms if p]  # strip empties

        # Validate all platform values
        platform_enums: list[Platform] = []
        for p in selected_platforms:
            try:
                platform_enums.append(Platform(p))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Unknown platform: {p}")

        # Primary platform drives the caption body (instagram is most versatile)
        PRIORITY = ["instagram", "facebook", "linkedin", "gbp"]
        primary = next((p for p in PRIORITY if p in selected_platforms), selected_platforms[0])
        body = captions.get(primary) or next((v for v in captions.values() if v), "")

        item = ContentItem(
            client_id=client_db_id,
            content_type=ContentType.social_caption,
            platform=platform_enums[0],   # primary platform for display/badge
            status=ContentStatus.pending_approval,
            body=body,
            image_url=media_item.url,
            meta={
                "platforms": selected_platforms,
                "captions": {p: captions.get(p, "") for p in selected_platforms},
            },
        )
        from datetime import datetime, timezone
        media_item.last_used_at = datetime.now(timezone.utc)

    elif req.content_type == "blog_post":
        draft = generate_blog_draft(
            config,
            topic=req.topic or None,
            recent_titles=recent_blog_titles(db, client_db_id),
            focus_keyword=req.focus_keyword or None,
        )

        # Select images from the media library that best match the article
        from sqlalchemy import nullsfirst
        from ..settings import get_settings
        from ..models import MediaItem as _MediaItem
        from core.content_generator import select_blog_images

        _api_url = get_settings().API_URL.rstrip("/")
        _allowed_ids = {client_db_id}
        if client_row.media_source_client_id:
            _allowed_ids.add(client_row.media_source_client_id)

        # Load all candidates ordered LRU, build one representative per project
        all_candidates = (
            db.query(_MediaItem)
            .filter(_MediaItem.client_id.in_(_allowed_ids))
            .order_by(nullsfirst(_MediaItem.last_used_at.asc()))
            .all()
        )

        # One rep per project (first = LRU within that project)
        project_reps: dict[str, _MediaItem] = {}
        no_project: list[_MediaItem] = []
        for m in all_candidates:
            project = (m.meta or {}).get("project") if m.meta else None
            if project:
                if project not in project_reps:
                    project_reps[project] = m
            else:
                if len(no_project) < 3:
                    no_project.append(m)

        # Ask Claude to pick the best-matching project
        blog_media = select_blog_images(
            title=draft["title"],
            body_excerpt=draft["body"][:600],
            project_reps=project_reps,
            count=BLOG_IMAGE_COUNT,
        )[:BLOG_IMAGE_COUNT]

        # Fall back to unorganised items if library has no project metadata
        if not blog_media:
            blog_media = no_project[:BLOG_IMAGE_COUNT]

        blog_image_urls = [m.url for m in blog_media]
        absolute_image_urls = [
            u if u.startswith("http") else f"{_api_url}{u}"
            for u in blog_image_urls
        ]
        enriched_body = _inject_blog_images(draft["body"], absolute_image_urls)

        # Update last_used_at on selected images
        from datetime import datetime, timezone as _tz
        _now = datetime.now(_tz.utc)
        for m in blog_media:
            m.last_used_at = _now

        item = ContentItem(
            client_id=client_db_id,
            content_type=ContentType.blog_post,
            status=ContentStatus.pending_approval,
            title=draft["title"],
            body=enriched_body,
            image_url=blog_image_urls[0] if blog_image_urls else None,
            # focus_keyword is recorded so later runs can pick a different one.
            meta={
                **({"blog_images": blog_image_urls} if blog_image_urls else {}),
                **({"focus_keyword": req.focus_keyword} if req.focus_keyword else {}),
            } or None,
        )

    elif req.content_type == "gbp_post":
        body = generate_gbp_post(config, topic=req.topic or None)
        item = ContentItem(
            client_id=client_db_id,
            content_type=ContentType.gbp_post,
            platform=Platform.gbp,
            status=ContentStatus.pending_approval,
            body=body,
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unknown content_type: {req.content_type}")

    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _run_batch(
    user_id: int,
    client_db_id: int,
    photo_ids: list[int],
    blog_count: int,
    platforms: list[str],
):
    """Generate a batch in the background, one item at a time.

    Runs off-request because a full batch is several Claude calls and would sit
    well past a proxy's read timeout. Each draft commits as it finishes, so the
    queue fills progressively and one failure does not discard the rest.
    """
    from core.content_generator import pick_blog_keywords, recent_blog_keywords
    from ..database import SessionLocal
    from ..models import Client

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        client_row = db.query(Client).filter(Client.id == client_db_id).first()
        if not user or not client_row:
            logger.error("Batch generation: user %s or client %s vanished", user_id, client_db_id)
            return

        for photo_id in photo_ids:
            try:
                generate_draft(
                    GenerateDraftRequest(
                        content_type="social_caption",
                        media_item_id=photo_id,
                        platforms=platforms,
                        client_id=client_db_id,
                    ),
                    current_user=user,
                    db=db,
                )
            except Exception as e:
                db.rollback()
                logger.error("Batch generation: social draft for photo %s failed: %s", photo_id, e)

        # Each blog gets its own keyword, chosen up front and skipping anything
        # recent posts already targeted. Listing previous titles and asking for
        # something different is not enough on its own — it yields a fresh title
        # on the same subject.
        keywords = pick_blog_keywords(
            client_row.client_id,
            blog_count,
            exclude=recent_blog_keywords(db, client_db_id),
        )
        for n, keyword in enumerate(keywords):
            try:
                generate_draft(
                    GenerateDraftRequest(
                        content_type="blog_post",
                        client_id=client_db_id,
                        focus_keyword=keyword,
                    ),
                    current_user=user,
                    db=db,
                )
            except Exception as e:
                db.rollback()
                logger.error("Batch generation: blog draft %s (%s) failed: %s", n + 1, keyword, e)

        logger.info("Batch generation finished for client %s", client_db_id)
    finally:
        db.close()


@router.post("/generate-batch", response_model=GenerateBatchResponse)
def generate_batch(
    req: GenerateBatchRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Queue a run of blog drafts plus multi-platform social drafts."""
    from core.config_loader import load_client_config
    from core.media_rotation import next_photos
    from ..models import Client

    if current_user.role == "admin" and req.client_id:
        client_db_id = req.client_id
    elif current_user.client_id:
        client_db_id = current_user.client_id
    else:
        raise HTTPException(status_code=400, detail="No client context")

    client_row = db.query(Client).filter(Client.id == client_db_id).first()
    if not client_row:
        raise HTTPException(status_code=404, detail="Client not found")

    config = load_client_config(client_row.client_id)

    # Claim the photos up front so the drafts cannot land on the same one — they
    # are only excluded from the rotation once a content item points at them.
    photos = next_photos(db, config, client_db_id, req.social_count)
    if not photos and req.social_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No unused photos left in this client's library",
        )

    background_tasks.add_task(
        _run_batch,
        user_id=current_user.id,
        client_db_id=client_db_id,
        photo_ids=[p.id for p in photos],
        blog_count=req.blog_count,
        platforms=req.platforms,
    )

    return GenerateBatchResponse(
        blog_count=req.blog_count,
        social_count=len(photos),
        platforms=req.platforms,
    )


@router.get("/", response_model=list[ContentItemResponse])
def list_pending(
    client_id: Optional[int] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Admins see all content items (filterable by status).
    Clients see what is with them plus what they just approved, so an approved
    item stays on screen (and undoable) rather than vanishing until it publishes.
    """
    if current_user.role == "admin":
        query = db.query(ContentItem)
        if client_id:
            query = query.filter(ContentItem.client_id == client_id)
        if status:
            try:
                query = query.filter(ContentItem.status == ContentStatus(status))
            except ValueError:
                pass  # ignore unknown status values
    else:
        client_ids = current_user.client_ids
        query = db.query(ContentItem).filter(
            ContentItem.status.in_(CLIENT_VISIBLE_STATUSES),
            ContentItem.client_id.in_(client_ids),
        )

    return query.order_by(ContentItem.created_at.desc()).all()


@router.get("/published", response_model=list[PublishedItemResponse])
def list_published(
    client_id: Optional[int] = None,
    limit: int = 200,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Everything that has gone live, however it got there."""
    query = db.query(ContentItem).filter(ContentItem.status == ContentStatus.published)

    if current_user.role == "admin":
        if client_id:
            query = query.filter(ContentItem.client_id == client_id)
    else:
        query = query.filter(ContentItem.client_id.in_(current_user.client_ids))

    items = (
        query.order_by(ContentItem.published_at.desc(), ContentItem.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    results = []
    for item in items:
        approver = item.approved_by
        results.append(PublishedItemResponse(
            id=item.id,
            client_id=item.client_id,
            content_type=item.content_type,
            platform=item.platform,
            title=item.title,
            body=item.body,
            image_url=item.image_url,
            published_at=item.published_at,
            approved_at=item.approved_at,
            meta=item.meta,
            published_via="auto" if approver is None else approver.role.value,
            approved_by_name=approver.name if approver else None,
        ))
    return results


@router.delete("/{item_id}")
def delete_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin permanently deletes a content item (discard)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    item = db.query(ContentItem).filter(ContentItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Content item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.post("/{item_id}/recall", response_model=ContentItemResponse)
def recall_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin recalls a draft from client review back to pending_approval."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    item = _get_item(item_id, current_user, db)
    if item.status != ContentStatus.client_review:
        raise HTTPException(status_code=400, detail="Item is not in client review")
    item.status = ContentStatus.pending_approval
    item.auto_publish_at = None
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/undo-approval", response_model=ContentItemResponse)
def undo_approval(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pull an approved item back into review. Only works before it publishes."""
    item = _get_item(item_id, current_user, db)
    if item.status not in UNDOABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This item has already published"
            if item.status == ContentStatus.published
            else f"Item cannot be undone (current status: {item.status.value})",
        )

    item.status = ContentStatus.client_review
    item.approved_by_id = None
    item.approved_at = None
    item.scheduled_for = None
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/send-to-client", response_model=ContentItemResponse)
def send_to_client(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin sends a draft to the client for their approval."""
    from ..auth import require_admin  # noqa
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    item = _get_item(item_id, current_user, db)
    sendable = {ContentStatus.pending_approval, ContentStatus.rejected}
    if item.status not in sendable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item cannot be sent to client (current: {item.status})"
        )
    item.status = ContentStatus.client_review
    item.rejection_reason = None  # clear any previous rejection note
    if item.content_type == ContentType.blog_post:
        item.auto_publish_at = datetime.now(timezone.utc) + timedelta(days=BLOG_REVIEW_WINDOW_DAYS)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ContentItemResponse)
def update_item(
    item_id: int,
    payload: UpdateContentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save edits without deciding on the item. Does not touch the review clock."""
    item = _get_item(item_id, current_user, db)

    # Clients may only edit while the item is actually with them.
    if current_user.role != "admin" and item.status != ContentStatus.client_review:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This item is no longer open for edits",
        )
    if current_user.role == "admin" and item.status in {
        ContentStatus.published, ContentStatus.scheduled
    }:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit an item that is {item.status.value}",
        )

    if payload.title is not None:
        item.title = payload.title
    if payload.body is not None:
        item.body = payload.body
    if payload.image_url is not None:
        item.image_url = payload.image_url or None

    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/approve", response_model=ContentItemResponse)
def approve_item(
    item_id: int,
    payload: ApproveContentRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_item(item_id, current_user, db)

    # failed is approvable so a post that errored on publish can be retried:
    # approving puts it back in front of the publish sweep.
    approvable = {
        ContentStatus.pending_approval,
        ContentStatus.client_review,
        ContentStatus.rejected,
        ContentStatus.failed,
    }
    if item.status not in approvable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item cannot be approved (current status: {item.status})"
        )

    if payload.body:
        item.body = payload.body
    if payload.image_url:
        item.image_url = payload.image_url
    if payload.scheduled_for:
        item.scheduled_for = payload.scheduled_for

    item.status = ContentStatus.approved
    item.approved_by_id = current_user.id
    item.approved_at = datetime.now(timezone.utc)
    # Clear the previous failure so a retry does not keep showing a stale error.
    item.error_message = None
    # auto_publish_at is left intact so undoing restores the original deadline
    # rather than granting a fresh window. The auto-publish job is status-gated.
    db.commit()
    db.refresh(item)

    # Trigger publish in background if scheduled_for is now or past
    background_tasks.add_task(_maybe_publish_now, item.id)

    return item


@router.post("/{item_id}/regenerate-caption", response_model=ContentItemResponse)
def regenerate_caption(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-run Claude vision on the same image to produce a new caption."""
    from core.config_loader import load_client_config
    from core.content_generator import generate_captions_from_image
    from ..models import Client

    item = _get_item(item_id, current_user, db)
    if not item.image_url:
        raise HTTPException(status_code=400, detail="Item has no image to generate caption from")

    client_row = db.query(Client).filter(Client.id == item.client_id).first()
    if not client_row:
        raise HTTPException(status_code=404, detail="Client not found")

    config = load_client_config(client_row.client_id)
    captions = generate_captions_from_image(config=config, image_path=item.image_url)

    platform_key = item.platform.value if item.platform else None
    if platform_key == "gbp":
        new_body = captions.get("gbp", "")
    elif platform_key:
        new_body = captions.get(platform_key, "")
    else:
        new_body = captions.get("instagram", "")

    item.body = new_body
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/regenerate-post", response_model=ContentItemResponse)
def regenerate_post(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pick the next least-recently-used image and regenerate caption for this platform."""
    from core.config_loader import load_client_config
    from core.content_generator import generate_captions_from_image
    from ..models import Client, MediaItem
    from datetime import datetime, timezone

    item = _get_item(item_id, current_user, db)
    client_row = db.query(Client).filter(Client.id == item.client_id).first()
    if not client_row:
        raise HTTPException(status_code=404, detail="Client not found")

    from sqlalchemy import nullsfirst
    media_item = (
        db.query(MediaItem)
        .filter(MediaItem.client_id == item.client_id)
        .order_by(nullsfirst(MediaItem.last_used_at.asc()))
        .first()
    )
    if not media_item:
        raise HTTPException(status_code=400, detail="No media items in library")

    config = load_client_config(client_row.client_id)
    captions = generate_captions_from_image(
        config=config,
        image_path=media_item.url,
        image_filename=media_item.filename,
    )

    platform_key = item.platform.value if item.platform else None
    if platform_key == "gbp":
        new_body = captions.get("gbp", "")
    elif platform_key:
        new_body = captions.get(platform_key, "")
    else:
        new_body = captions.get("instagram", "")

    item.body = new_body
    item.image_url = media_item.url
    media_item.last_used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/reject", response_model=ContentItemResponse)
def reject_item(
    item_id: int,
    payload: RejectContentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_item(item_id, current_user, db)

    rejectable = {ContentStatus.pending_approval, ContentStatus.client_review}
    if item.status not in rejectable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item cannot be rejected (current status: {item.status})"
        )

    item.status = ContentStatus.rejected
    item.rejection_reason = payload.reason
    item.auto_publish_at = None
    db.commit()
    db.refresh(item)
    return item


# ── Helpers ───────────────────────────────────────────────────────────────────

def _img_block(url: str) -> str:
    return (
        f'<figure style="margin:2rem 0;">'
        f'<img src="{url}" alt="" '
        f'style="max-width:100%;height:auto;border-radius:6px;display:block;" />'
        f'</figure>'
    )


def _inject_blog_images(html: str, image_urls: list[str]) -> str:
    """Insert image blocks at natural section breaks in blog HTML.

    The first image goes after the opening paragraph, which is where a lead
    image belongs. Any further images are spaced out, one after each subsequent
    <h2> section's first paragraph — drafts currently carry a single image, but
    the placement holds if that changes.
    """
    if not image_urls:
        return html

    img_index = 0
    cursor = 0  # tracks position in the (growing) html string

    # 1. Insert first image after the very first </p>
    first_p = html.find("</p>", cursor)
    if first_p != -1 and img_index < len(image_urls):
        block = "\n" + _img_block(image_urls[img_index]) + "\n"
        insert_at = first_p + len("</p>")
        html = html[:insert_at] + block + html[insert_at:]
        cursor = insert_at + len(block)
        img_index += 1

    # 2. Insert remaining images after each successive <h2> section's first </p>
    while img_index < len(image_urls):
        h2_pos = html.find("<h2", cursor)
        if h2_pos == -1:
            break
        next_p_end = html.find("</p>", h2_pos)
        if next_p_end == -1:
            break
        block = "\n" + _img_block(image_urls[img_index]) + "\n"
        insert_at = next_p_end + len("</p>")
        html = html[:insert_at] + block + html[insert_at:]
        cursor = insert_at + len(block)
        img_index += 1

    return html


def _get_item(item_id: int, current_user: User, db: Session) -> ContentItem:
    item = db.query(ContentItem).filter(ContentItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Content item not found")

    # Clients can only act on content belonging to their assigned clients
    if current_user.role != "admin" and item.client_id not in current_user.client_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    return item


def _maybe_publish_now(item_id: int):
    """Publish the item immediately if it has no future scheduled_for date."""
    from ..database import SessionLocal
    from ..models import ContentItem, ContentStatus, ContentType, Platform
    from core.config_loader import load_client_config
    from core.publer_publisher import publish_social_post, publish_gbp_post
    from core.webflow_publisher import publish_blog_post
    from datetime import datetime, timezone
    import logging

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    now = datetime.now(timezone.utc)

    try:
        item = db.query(ContentItem).filter(ContentItem.id == item_id).first()
        if not item:
            return

        # Only publish if no future schedule date
        scheduled_for = _as_utc(item.scheduled_for)
        if scheduled_for and scheduled_for > now:
            return

        from portal.api.models import Client
        client_row = db.query(Client).filter(Client.id == item.client_id).first()
        if not client_row:
            return

        config = load_client_config(client_row.client_id)

        item.status = ContentStatus.scheduled
        db.commit()

        if item.content_type == ContentType.social_caption and item.platform:
            # Use all platforms from meta if available, otherwise fall back to single platform
            publish_platforms = (item.meta or {}).get("platforms") or [item.platform.value]
            result = publish_social_post(
                config=config,
                body=item.body,
                platforms=publish_platforms,
                image_url=item.image_url,
                as_draft=False,
            )
            item.publer_post_id = str(result.get("job_id", ""))

        elif item.content_type == ContentType.gbp_post:
            result = publish_gbp_post(
                config=config,
                body=item.body,
                image_url=item.image_url,
            )
            item.publer_post_id = str(result.get("job_id", ""))

        elif item.content_type == ContentType.blog_post:
            publish_blog_post(
                config=config,
                title=item.title or "Untitled",
                body=item.body,
                publish_immediately=True,
            )

        item.status = ContentStatus.published
        item.published_at = now
        db.commit()
        logger.info(f"Published content item {item_id} ({item.content_type})")

    except Exception as e:
        logger.error(f"Failed to publish item {item_id}: {e}")
        try:
            item = db.query(ContentItem).filter(ContentItem.id == item_id).first()
            if item:
                item.status = ContentStatus.failed
                item.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
