"""routes/reviews.py - Review monitoring and response approval endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Review, ContentItem, ContentStatus, User
from ..auth import get_current_user
from ..schemas import ReviewResponse, ContentItemResponse

router = APIRouter()


@router.get("/", response_model=list[ReviewResponse])
def list_reviews(
    client_id: Optional[int] = Query(None),
    responded: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Review)

    if current_user.role != "admin":
        query = query.filter(Review.client_id == current_user.client_id)
    elif client_id:
        query = query.filter(Review.client_id == client_id)

    if responded is not None:
        if responded:
            query = query.filter(Review.responded_at.isnot(None))
        else:
            query = query.filter(Review.responded_at.is_(None))

    return query.order_by(Review.detected_at.desc()).all()


@router.get("/{review_id}/response", response_model=ContentItemResponse)
def get_review_response(
    review_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the drafted response for a review."""
    review = _get_review(review_id, current_user, db)
    if not review.response_content_id:
        raise HTTPException(status_code=404, detail="No response drafted yet")

    return db.query(ContentItem).filter(
        ContentItem.id == review.response_content_id
    ).first()


def _get_review(review_id: int, current_user: User, db: Session) -> Review:
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if current_user.role != "admin" and review.client_id != current_user.client_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return review
