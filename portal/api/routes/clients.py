"""routes/clients.py - Client management endpoints (admin only for writes)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Client, User
from ..auth import get_current_user, require_admin
from ..schemas import ClientResponse

router = APIRouter()


@router.get("/", response_model=list[ClientResponse])
def list_clients(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admins see all clients. Clients see only their own."""
    if current_user.role == "admin":
        return db.query(Client).filter(Client.is_active == True).all()
    if current_user.client_id:
        return db.query(Client).filter(
            Client.id == current_user.client_id,
            Client.is_active == True,
        ).all()
    return []


@router.get("/{client_id}", response_model=ClientResponse)
def get_client(
    client_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if current_user.role != "admin" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return client
