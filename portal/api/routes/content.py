"""routes/content.py - Content queue endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ContentItem, ContentStatus, ContentType, User
from ..auth import get_current_user
from ..schemas import ContentItemResponse

router = APIRouter()


@router.get("/", response_model=list[ContentItemResponse])
def list_content(
    status: Optional[ContentStatus] = None,
    content_type: Optional[ContentType] = None,
    client_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ContentItem)

    # Scope to client
    if current_user.role != "admin":
        query = query.filter(ContentItem.client_id == current_user.client_id)
    elif client_id:
        query = query.filter(ContentItem.client_id == client_id)

    if status:
        query = query.filter(ContentItem.status == status)
    if content_type:
        query = query.filter(ContentItem.content_type == content_type)

    return (
        query.order_by(ContentItem.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/{item_id}", response_model=ContentItemResponse)
def get_content_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(ContentItem).filter(ContentItem.id == item_id).first()
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Content item not found")

    if current_user.role != "admin" and item.client_id != current_user.client_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Access denied")

    return item
