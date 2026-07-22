"""routes/clients.py - Client management endpoints."""

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Client, User, UserRole
from ..auth import get_current_user, require_admin, hash_password
from ..schemas import (
    ClientResponse, ClientDetailResponse,
    CreateClientRequest, UpdateClientRequest,
    InviteUserRequest, UserResponse,
)

router = APIRouter()

CLIENTS_DIR = Path(__file__).parent.parent.parent.parent / "clients"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _config_path(client_id: str) -> Path:
    return CLIENTS_DIR / client_id / "config.json"


def _read_config(client_id: str) -> dict:
    path = _config_path(client_id)
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


def _write_config(client_id: str, data: dict) -> None:
    path = _config_path(client_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _build_config_dict(client: Client, req: CreateClientRequest | UpdateClientRequest, existing: dict | None = None) -> dict:
    base = existing or {}
    return {
        "client_id": client.client_id,
        "brand_name": client.brand_name,
        "industry": client.industry,
        "tone": client.tone,
        "location": {
            "city": client.location_city,
            "state": client.location_state,
            "lat": client.location_lat,
            "lng": client.location_lng,
        },
        "social": base.get("social", {"instagram": {}, "facebook": {}, "linkedin": {}}),
        "publer": {
            "workspace_id": _pick(req, "publer_workspace_id", base.get("publer", {}).get("workspace_id", "")),
            "social_profile_ids": {
                "instagram": _pick(req, "publer_instagram_id", base.get("publer", {}).get("social_profile_ids", {}).get("instagram", "")),
                "facebook": _pick(req, "publer_facebook_id", base.get("publer", {}).get("social_profile_ids", {}).get("facebook", "")),
                "linkedin": _pick(req, "publer_linkedin_id", base.get("publer", {}).get("social_profile_ids", {}).get("linkedin", "")),
                "gbp": _pick(req, "publer_gbp_id", base.get("publer", {}).get("social_profile_ids", {}).get("gbp", "")),
            },
        },
        "gbp": {
            "location_id": _pick(req, "gbp_location_id", base.get("gbp", {}).get("location_id", "")),
            "account_id": _pick(req, "gbp_account_id", base.get("gbp", {}).get("account_id", "")),
            "google_credentials_file": _pick(req, "gbp_credentials_file", base.get("gbp", {}).get("google_credentials_file", "")),
        },
        "local_falcon": {
            "api_key": _pick(req, "local_falcon_api_key", (base.get("local_falcon") or {}).get("api_key", "")),
            "place_id": _pick(req, "local_falcon_place_id", (base.get("local_falcon") or {}).get("place_id", "")),
        },
        "schedule": {
            "social_posts_per_month": _pick(req, "social_posts_per_month", base.get("schedule", {}).get("social_posts_per_month", 12)),
            "blog_posts_per_month": _pick(req, "blog_posts_per_month", base.get("schedule", {}).get("blog_posts_per_month", 1)),
            "gbp_posts_per_month": _pick(req, "gbp_posts_per_month", base.get("schedule", {}).get("gbp_posts_per_month", 4)),
            "gbp_image_uploads_per_week": _pick(req, "gbp_image_uploads_per_week", base.get("schedule", {}).get("gbp_image_uploads_per_week", 1)),
            "report_day_of_month": _pick(req, "report_day_of_month", base.get("schedule", {}).get("report_day_of_month", 1)),
            "serp_check_day_of_month": _pick(req, "serp_check_day_of_month", base.get("schedule", {}).get("serp_check_day_of_month", 1)),
            "review_check_interval_hours": _pick(req, "review_check_interval_hours", base.get("schedule", {}).get("review_check_interval_hours", 24)),
            "directory_check_day_of_month": _pick(req, "directory_check_day_of_month", base.get("schedule", {}).get("directory_check_day_of_month", 15)),
        },
        "directories_to_monitor": _pick(req, "directories_to_monitor", base.get("directories_to_monitor", ["google", "yelp", "bbb", "yellowpages", "bing"])),
        "drive": {
            "asset_folder_id": _pick(req, "drive_folder_id", (base.get("drive") or {}).get("asset_folder_id", "")),
        },
        "notifications": {
            "client_email": _pick(req, "client_email", base.get("notifications", {}).get("client_email", "")),
            "admin_email": _pick(req, "admin_email", base.get("notifications", {}).get("admin_email", "")),
        },
        "portal_users": base.get("portal_users", []),
        # Pass-through fields not managed by the portal form — preserve whatever was in the config
        **({"gsc": base["gsc"]} if "gsc" in base else {}),
        **({"webflow": base["webflow"]} if "webflow" in base else {}),
    }


def _pick(req, field: str, default):
    """Return request field value if present and not None, else default."""
    val = getattr(req, field, None)
    if val is None:
        return default
    return val


def _detail_from(client: Client, cfg: dict, db: Session) -> dict:
    publer = cfg.get("publer") or {}
    pids = publer.get("social_profile_ids") or {}
    gbp = cfg.get("gbp") or {}
    sched = cfg.get("schedule") or {}
    notif = cfg.get("notifications") or {}
    # Users assigned to this client via the join table
    users = [u for u in client.portal_users if u.is_active]
    return {
        "id": client.id,
        "client_id": client.client_id,
        "brand_name": client.brand_name,
        "industry": client.industry,
        "tone": client.tone,
        "location_city": client.location_city,
        "location_state": client.location_state,
        "location_lat": client.location_lat,
        "location_lng": client.location_lng,
        "is_active": client.is_active,
        "created_at": client.created_at,
        "publer_workspace_id": publer.get("workspace_id", ""),
        "publer_instagram_id": pids.get("instagram", ""),
        "publer_facebook_id": pids.get("facebook", ""),
        "publer_linkedin_id": pids.get("linkedin", ""),
        "publer_gbp_id": pids.get("gbp", ""),
        "gbp_location_id": gbp.get("location_id", ""),
        "gbp_account_id": gbp.get("account_id", ""),
        "gbp_credentials_file": gbp.get("google_credentials_file", ""),
        "local_falcon_api_key": (cfg.get("local_falcon") or {}).get("api_key", ""),
        "local_falcon_place_id": (cfg.get("local_falcon") or {}).get("place_id", ""),
        "social_posts_per_month": sched.get("social_posts_per_month", 12),
        "blog_posts_per_month": sched.get("blog_posts_per_month", 1),
        "gbp_posts_per_month": sched.get("gbp_posts_per_month", 4),
        "gbp_image_uploads_per_week": sched.get("gbp_image_uploads_per_week", 1),
        "report_day_of_month": sched.get("report_day_of_month", 1),
        "serp_check_day_of_month": sched.get("serp_check_day_of_month", 1),
        "review_check_interval_hours": sched.get("review_check_interval_hours", 24),
        "directory_check_day_of_month": sched.get("directory_check_day_of_month", 15),
        "directories_to_monitor": cfg.get("directories_to_monitor", ["google", "yelp", "bbb", "yellowpages", "bing"]),
        "drive_folder_id": (cfg.get("drive") or {}).get("asset_folder_id", ""),
        "client_email": notif.get("client_email", ""),
        "admin_email": notif.get("admin_email", ""),
        "media_source_client_id": client.media_source_client_id,
        "users": users,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ClientResponse])
def list_clients(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "admin":
        return db.query(Client).filter(Client.is_active == True).order_by(Client.brand_name).all()
    # Non-admin: return all clients they're assigned to via user_clients
    return [c for c in current_user.clients if c.is_active]


@router.get("/{client_id}/detail", response_model=ClientDetailResponse)
def get_client_detail(
    client_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = _read_config(client.client_id)
    return _detail_from(client, cfg, db)


@router.post("/", response_model=ClientDetailResponse, status_code=201)
def create_client(
    req: CreateClientRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(Client).filter(Client.client_id == req.client_id).first():
        raise HTTPException(status_code=409, detail="client_id already exists")

    client = Client(
        client_id=req.client_id,
        brand_name=req.brand_name,
        industry=req.industry,
        tone=req.tone,
        location_city=req.location_city,
        location_state=req.location_state,
        location_lat=req.location_lat,
        location_lng=req.location_lng,
    )
    db.add(client)
    db.commit()
    db.refresh(client)

    cfg = _build_config_dict(client, req)
    _write_config(client.client_id, cfg)

    return _detail_from(client, cfg, db)


@router.put("/{client_id}", response_model=ClientDetailResponse)
def update_client(
    client_id: int,
    req: UpdateClientRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    for field in ("brand_name", "industry", "tone", "location_city", "location_state", "location_lat", "location_lng", "is_active", "media_source_client_id"):
        val = getattr(req, field, None)
        if val is not None:
            setattr(client, field, val)

    db.commit()
    db.refresh(client)

    existing = _read_config(client.client_id)
    cfg = _build_config_dict(client, req, existing)
    _write_config(client.client_id, cfg)

    return _detail_from(client, cfg, db)


@router.get("/{client_id}/users", response_model=list[UserResponse])
def list_client_users(
    client_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return [u for u in client.portal_users if u.is_active]


@router.post("/{client_id}/users", response_model=UserResponse, status_code=201)
def invite_user(
    client_id: int,
    req: InviteUserRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=409, detail="Email already in use")

    user = User(
        email=req.email,
        name=req.name,
        role=req.role,
        client_id=client_id,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.flush()  # get user.id before adding to join table
    client.portal_users.append(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{client_id}/users/{user_id}", response_model=UserResponse)
def add_user_to_client(
    client_id: int,
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Add an existing user to a client (many-to-many)."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user not in client.portal_users:
        client.portal_users.append(user)
        db.commit()
        db.refresh(user)
    return user


@router.delete("/{client_id}/users/{user_id}", status_code=204)
def remove_user(
    client_id: int,
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Remove a user from a client (removes the join-table row; does not deactivate the user)."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user not in client.portal_users:
        raise HTTPException(status_code=404, detail="User not found on this client")
    client.portal_users.remove(user)
    # If this was their primary client_id, clear it too
    if user.client_id == client_id:
        remaining = [c for c in user.clients if c.id != client_id]
        user.client_id = remaining[0].id if remaining else None
    db.commit()


@router.get("/{client_id}/keywords/info")
def get_keyword_file_info(
    client_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return metadata about the uploaded keyword CSV for a client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    path = CLIENTS_DIR / client.client_id / "keywords" / "keywords.csv"
    if not path.exists():
        return {"exists": False}

    stat = path.stat()
    rows = []
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
    except Exception:
        return {"exists": True, "row_count": 0, "preview": [], "updated_at": None}

    preview = [r.get("keyword") or next(iter(r.values()), "") for r in rows[:8]]
    updated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
    return {
        "exists": True,
        "row_count": len(rows),
        "preview": [k for k in preview if k],
        "updated_at": updated_at,
    }


@router.post("/{client_id}/keywords/upload")
async def upload_keyword_file(
    client_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Upload a keyword CSV file for a client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    contents = await file.read()
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = contents.decode("latin-1")

    # Validate it's a parseable CSV with at least a keyword column
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    if not any("keyword" in f.lower() for f in fieldnames):
        raise HTTPException(status_code=400, detail="CSV must have a 'keyword' column")

    dest = CLIENTS_DIR / client.client_id / "keywords"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "keywords.csv").write_text(text, encoding="utf-8")

    rows = list(csv.DictReader(io.StringIO(text)))
    preview = [r.get("keyword") or next(iter(r.values()), "") for r in rows[:8]]
    return {
        "ok": True,
        "row_count": len(rows),
        "preview": [k for k in preview if k],
    }


@router.post("/{client_id}/drive-sync")
def trigger_drive_sync(
    client_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Immediately sync Drive photos into the media library for this client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    try:
        from core.config_loader import load_client_config
        from core.drive_watcher import sync_drive_to_media_library

        config = load_client_config(client.client_id)
        new_count = sync_drive_to_media_library(config, client.id, db)
        return {"imported": new_count}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{client_id}", response_model=ClientResponse)
def get_client(
    client_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if current_user.role != "admin" and client_id not in current_user.client_ids:
        raise HTTPException(status_code=403, detail="Access denied")
    return client
