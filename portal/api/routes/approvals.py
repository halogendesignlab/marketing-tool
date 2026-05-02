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
    """If the item has no scheduled_for or it's in the past, mark it for immediate publish.
    The scheduler picks up 'approved' items and publishes them."""
    # Publishing is handled by the scheduler — this is a hook for future immediate-publish logic
    pass
