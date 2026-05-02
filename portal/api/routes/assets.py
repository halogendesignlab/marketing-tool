"""routes/assets.py - Asset management endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, User
from ..auth import get_current_user
from ..schemas import AssetResponse

router = APIRouter()


@router.get("/", response_model=list[AssetResponse])
def list_assets(
    client_id: Optional[int] = Query(None),
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Asset)

    if current_user.role != "admin":
        query = query.filter(Asset.client_id == current_user.client_id)
    elif client_id:
        query = query.filter(Asset.client_id == client_id)

    if status:
        query = query.filter(Asset.status == status)

    return query.order_by(Asset.detected_at.desc()).all()


@router.post("/{asset_id}/approve", response_model=AssetResponse)
def approve_asset(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Approve an asset for GBP upload. Upload is handled by the scheduler."""
    asset = _get_asset(asset_id, current_user, db)
    asset.status = "approved"
    db.commit()
    db.refresh(asset)
    return asset


@router.post("/{asset_id}/reject", response_model=AssetResponse)
def reject_asset(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = _get_asset(asset_id, current_user, db)
    asset.status = "rejected"
    db.commit()
    db.refresh(asset)
    return asset


def _get_asset(asset_id: int, current_user: User, db: Session) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if current_user.role != "admin" and asset.client_id != current_user.client_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return asset
