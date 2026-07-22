"""routes/users.py — Admin user management endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Client, UserRole
from ..auth import require_admin, hash_password
from ..schemas import UpdateUserRequest, UserWithClientResponse

router = APIRouter()


def _build_response(user: User, db: Session) -> UserWithClientResponse:
    """Build a UserWithClientResponse from a User ORM object."""
    client_ids = [c.id for c in user.clients]
    client_names = [c.brand_name for c in user.clients]
    # Legacy single-client fields: use the primary client_id or first in list
    primary = db.query(Client).filter(Client.id == user.client_id).first() if user.client_id else None
    return UserWithClientResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        client_id=user.client_id,
        client_name=primary.brand_name if primary else (client_names[0] if client_names else None),
        client_ids=client_ids,
        client_names=client_names,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.get("/", response_model=list[UserWithClientResponse])
def list_all_users(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return all users (active and inactive) with their client assignments."""
    users = db.query(User).order_by(User.name).all()
    return [_build_response(u, db) for u in users]


@router.put("/{user_id}", response_model=UserWithClientResponse)
def update_user(
    user_id: int,
    req: UpdateUserRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.email is not None and req.email != user.email:
        conflict = db.query(User).filter(User.email == req.email, User.id != user_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = req.email

    if req.name is not None:
        user.name = req.name
    if req.role is not None:
        user.role = req.role
    if req.password:
        user.hashed_password = hash_password(req.password)
    if req.is_active is not None:
        user.is_active = req.is_active

    # Update client assignments if provided
    if req.client_ids is not None:
        new_clients = db.query(Client).filter(Client.id.in_(req.client_ids)).all() if req.client_ids else []
        user.clients = new_clients
        # Keep client_id in sync: use first assigned client or None
        user.client_id = new_clients[0].id if new_clients else None

    db.commit()
    db.refresh(user)
    return _build_response(user, db)
