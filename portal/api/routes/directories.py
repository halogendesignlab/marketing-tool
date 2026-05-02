"""routes/directories.py - Directory/NAP monitoring endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import DirectoryListing, User
from ..auth import get_current_user
from ..schemas import DirectoryListingResponse

router = APIRouter()


@router.get("/", response_model=list[DirectoryListingResponse])
def list_directory_listings(
    client_id: Optional[int] = Query(None),
    issues_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(DirectoryListing)

    if current_user.role != "admin":
        query = query.filter(DirectoryListing.client_id == current_user.client_id)
    elif client_id:
        query = query.filter(DirectoryListing.client_id == client_id)

    if issues_only:
        query = query.filter(DirectoryListing.is_consistent == False)

    return query.order_by(DirectoryListing.directory).all()


@router.get("/{listing_id}", response_model=DirectoryListingResponse)
def get_listing(
    listing_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    listing = db.query(DirectoryListing).filter(DirectoryListing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if current_user.role != "admin" and listing.client_id != current_user.client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return listing
