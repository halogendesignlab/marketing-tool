"""routes/media.py — Media library: folders and image management."""

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User, UserRole, MediaFolder, MediaItem
from ..schemas import (
    CreateFolderRequest,
    MediaFolderResponse,
    MediaItemResponse,
    MoveItemRequest,
)

UPLOADS_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

router = APIRouter()


def _client_id_for(user: User, db: Session, client_id: Optional[int] = None) -> int:
    from ..models import Client
    if user.role == UserRole.admin:
        if client_id:
            resolved = client_id
        else:
            first = db.query(Client).filter(Client.is_active == True).order_by(Client.id).first()
            if not first:
                raise HTTPException(status_code=404, detail="No clients found")
            resolved = first.id
    else:
        # Use first assigned client from join table, falling back to client_id field
        ids = user.client_ids
        resolved = ids[0] if ids else user.client_id
        if not resolved:
            raise HTTPException(status_code=400, detail="User has no client association")

    # Resolve shared media source: if this client delegates its library to another, use that one
    client = db.query(Client).filter(Client.id == resolved).first()
    if client and client.media_source_client_id:
        return client.media_source_client_id
    return resolved


def _build_tree(folders: list[MediaFolder], counts: dict[int, int]) -> list[MediaFolderResponse]:
    by_id: dict[int, MediaFolderResponse] = {
        f.id: MediaFolderResponse(
            id=f.id,
            name=f.name,
            parent_id=f.parent_id,
            children=[],
            item_count=counts.get(f.id, 0),
        )
        for f in folders
    }
    roots: list[MediaFolderResponse] = []
    for f in folders:
        node = by_id[f.id]
        if f.parent_id and f.parent_id in by_id:
            by_id[f.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


# ── Folders ───────────────────────────────────────────────────────────────────

@router.get("/folders", response_model=list[MediaFolderResponse])
def list_folders(
    client_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db, client_id)
    folders = db.query(MediaFolder).filter(MediaFolder.client_id == client_id).all()

    # Count items per folder
    items = db.query(MediaItem).filter(MediaItem.client_id == client_id).all()
    counts: dict[int, int] = {}
    for item in items:
        if item.folder_id:
            counts[item.folder_id] = counts.get(item.folder_id, 0) + 1

    return _build_tree(folders, counts)


@router.post("/folders", response_model=MediaFolderResponse)
def create_folder(
    req: CreateFolderRequest,
    client_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db, client_id)

    if req.parent_id:
        parent = db.query(MediaFolder).filter(
            MediaFolder.id == req.parent_id, MediaFolder.client_id == client_id
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")

    folder = MediaFolder(client_id=client_id, name=req.name, parent_id=req.parent_id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return MediaFolderResponse(id=folder.id, name=folder.name, parent_id=folder.parent_id, children=[], item_count=0)


@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db)
    folder = db.query(MediaFolder).filter(
        MediaFolder.id == folder_id, MediaFolder.client_id == client_id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Move items in this folder to root (no folder)
    db.query(MediaItem).filter(
        MediaItem.folder_id == folder_id
    ).update({"folder_id": None})

    # Re-parent any child folders to this folder's parent
    db.query(MediaFolder).filter(
        MediaFolder.parent_id == folder_id
    ).update({"parent_id": folder.parent_id})

    db.delete(folder)
    db.commit()
    return {"ok": True}


# ── Media items ───────────────────────────────────────────────────────────────

def _meta_key(key: str):
    """Read one key out of MediaItem.meta as text.

    Goes through SQLAlchemy's JSON accessor rather than func.json_extract so the
    dialect picks the right syntax — json_extract on SQLite locally, ->> on the
    Postgres box in production, where json_extract does not exist at all.
    """
    return MediaItem.meta[key].as_string()


def _apply_meta_filters(q, search: Optional[str], category: Optional[str], project: Optional[str], photo_type: Optional[str]):
    """Apply metadata + text search filters to a MediaItem query."""
    from sqlalchemy import or_
    if category:
        q = q.filter(_meta_key("category") == category)
    if project:
        q = q.filter(_meta_key("project") == project)
    if photo_type:
        q = q.filter(_meta_key("photo_type") == photo_type)
    if search:
        pattern = f"%{search}%"
        q = q.filter(or_(
            MediaItem.filename.ilike(pattern),
            _meta_key("project").ilike(pattern),
            _meta_key("category").ilike(pattern),
        ))
    return q


@router.get("/filters")
def list_filters(
    client_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return distinct metadata filter values for a client."""
    client_id = _client_id_for(current_user, db, client_id)

    def _distinct(key: str) -> list[str]:
        col = _meta_key(key)
        rows = db.query(col).filter(
            MediaItem.client_id == client_id,
            MediaItem.meta.isnot(None),
            col.isnot(None),
        ).distinct().all()
        return sorted({r[0] for r in rows if r[0]})

    return {
        "categories": _distinct("category"),
        "projects": _distinct("project"),
        "photo_types": _distinct("photo_type"),
    }


@router.get("/items", response_model=list[MediaItemResponse])
def list_items(
    folder_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    photo_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db, client_id)
    q = db.query(MediaItem).filter(MediaItem.client_id == client_id)
    if folder_id is not None:
        q = q.filter(MediaItem.folder_id == folder_id)
    q = _apply_meta_filters(q, search, category, project, photo_type)
    return q.order_by(MediaItem.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/items/unorganized", response_model=list[MediaItemResponse])
def list_unorganized(
    client_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    photo_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db, client_id)
    q = db.query(MediaItem).filter(MediaItem.client_id == client_id, MediaItem.folder_id.is_(None))
    q = _apply_meta_filters(q, search, category, project, photo_type)
    return q.order_by(MediaItem.created_at.desc()).offset(offset).limit(limit).all()


@router.post("/upload", response_model=MediaItemResponse)
async def upload_image(
    folder_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, and GIF images are allowed")

    client_id = _client_id_for(current_user, db, client_id)

    if folder_id is not None:
        folder = db.query(MediaFolder).filter(
            MediaFolder.id == folder_id, MediaFolder.client_id == client_id
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    ext = Path(file.filename or "image.jpg").suffix or ".jpg"
    unique_name = f"{uuid.uuid4().hex}{ext}"

    client_dir = UPLOADS_DIR / str(client_id)
    client_dir.mkdir(parents=True, exist_ok=True)

    dest = client_dir / unique_name
    content = await file.read()
    dest.write_bytes(content)

    url = f"/uploads/{client_id}/{unique_name}"
    item = MediaItem(
        client_id=client_id,
        folder_id=folder_id,
        filename=file.filename or unique_name,
        url=url,
        mime_type=file.content_type or "image/jpeg",
        size=len(content),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/items/{item_id}/move", response_model=MediaItemResponse)
def move_item(
    item_id: int,
    req: MoveItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db)
    item = db.query(MediaItem).filter(
        MediaItem.id == item_id, MediaItem.client_id == client_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    if req.folder_id is not None:
        folder = db.query(MediaFolder).filter(
            MediaFolder.id == req.folder_id, MediaFolder.client_id == client_id
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Target folder not found")

    item.folder_id = req.folder_id
    db.commit()
    db.refresh(item)
    return item


@router.get("/items/count")
def count_items(
    folder_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    photo_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db, client_id)
    q = db.query(MediaItem).filter(MediaItem.client_id == client_id)
    if folder_id is not None:
        q = q.filter(MediaItem.folder_id == folder_id)
    q = _apply_meta_filters(q, search, category, project, photo_type)
    return {"count": q.count()}


@router.get("/drive-preview/{file_id}")
def drive_preview(
    file_id: str,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Stream a Drive image via service account. Token passed as query param since img tags can't send headers."""
    from ..auth import decode_token
    import io
    # Validate token manually
    try:
        payload = decode_token(token)
        email = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = db.query(User).filter(User.email == email, User.is_active == True).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        from core.drive_watcher import get_file_bytes
        data, mime_type = get_file_bytes(file_id)
        return StreamingResponse(io.BytesIO(data), media_type=mime_type, headers={
            "Cache-Control": "private, max-age=3600",
        })
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Could not fetch Drive file: {e}")


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_id = _client_id_for(current_user, db)
    item = db.query(MediaItem).filter(
        MediaItem.id == item_id, MediaItem.client_id == client_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    # Remove the file from disk
    if item.url.startswith("/uploads/"):
        local = UPLOADS_DIR / item.url.removeprefix("/uploads/")
        if local.exists():
            local.unlink()

    db.delete(item)
    db.commit()
    return {"ok": True}
