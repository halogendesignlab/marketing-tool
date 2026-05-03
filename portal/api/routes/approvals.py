"""routes/approvals.py — Approve, edit, or reject content items."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ContentItem, ContentStatus, User
from ..auth import get_current_user
from ..schemas import ContentItemResponse, ApproveContentRequest, RejectContentRequest

router = APIRouter()


@router.get("/", response_model=list[ContentItemResponse])
def list_pending(
    client_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all pending approval items. Clients see only their own."""
    query = db.query(ContentItem).filter(
        ContentItem.status == ContentStatus.pending_approval
    )

    if current_user.role != "admin":
        query = query.filter(ContentItem.client_id == current_user.client_id)
    elif client_id:
        query = query.filter(ContentItem.client_id == client_id)

    return query.order_by(ContentItem.created_at.desc()).all()


@router.post("/{item_id}/approve", response_model=ContentItemResponse)
def approve_item(
    item_id: int,
    payload: ApproveContentRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_item(item_id, current_user, db)

    if item.status != ContentStatus.pending_approval:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is not pending approval (current status: {item.status})"
        )

    # Allow editing body on approval
    if payload.body:
        item.body = payload.body
    if payload.scheduled_for:
        item.scheduled_for = payload.scheduled_for

    item.status = ContentStatus.approved
    item.approved_by_id = current_user.id
    item.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    # Trigger publish in background if scheduled_for is now or past
    background_tasks.add_task(_maybe_publish_now, item.id)

    return item


@router.post("/{item_id}/reject", response_model=ContentItemResponse)
def reject_item(
    item_id: int,
    payload: RejectContentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_item(item_id, current_user, db)

    if item.status != ContentStatus.pending_approval:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is not pending approval (current status: {item.status})"
        )

    item.status = ContentStatus.rejected
    item.rejection_reason = payload.reason
    db.commit()
    db.refresh(item)
    return item


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_item(item_id: int, current_user: User, db: Session) -> ContentItem:
    item = db.query(ContentItem).filter(ContentItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Content item not found")

    # Clients can only act on their own content
    if current_user.role != "admin" and item.client_id != current_user.client_id:
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
        if item.scheduled_for and item.scheduled_for > now:
            return

        from portal.api.models import Client
        client_row = db.query(Client).filter(Client.id == item.client_id).first()
        if not client_row:
            return

        config = load_client_config(client_row.client_id)

        item.status = ContentStatus.scheduled
        db.commit()

        if item.content_type == ContentType.social_caption and item.platform:
            result = publish_social_post(
                config=config,
                body=item.body,
                platforms=[item.platform.value],
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
