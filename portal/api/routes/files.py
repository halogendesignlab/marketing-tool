"""routes/files.py — Client file sharing: admin uploads, clients download."""

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import User, UserRole, ClientFile, Client
from ..schemas import ClientFileResponse

FILES_DIR = Path(__file__).parent.parent.parent.parent / "uploads" / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter()


def _resolve_client_id(user: User, db: Session, client_id: Optional[int]) -> int:
    if user.role == UserRole.admin:
        if not client_id:
            raise HTTPException(status_code=400, detail="client_id required")
        return client_id
    ids = user.client_ids
    resolved = ids[0] if ids else user.client_id
    if not resolved:
        raise HTTPException(status_code=400, detail="User has no client association")
    return resolved


@router.get("/", response_model=list[ClientFileResponse])
def list_files(
    client_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cid = _resolve_client_id(current_user, db, client_id)
    return (
        db.query(ClientFile)
        .filter(ClientFile.client_id == cid)
        .order_by(ClientFile.created_at.desc())
        .all()
    )


@router.post("/upload", response_model=ClientFileResponse)
async def upload_file(
    client_id: int = Query(...),
    description: Optional[str] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    ext = Path(file.filename or "file").suffix
    stored_name = f"{uuid.uuid4().hex}{ext}"
    client_dir = FILES_DIR / str(client_id)
    client_dir.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    (client_dir / stored_name).write_bytes(content)

    record = ClientFile(
        client_id=client_id,
        uploaded_by=current_user.id,
        filename=file.filename or stored_name,
        stored_name=stored_name,
        mime_type=file.content_type or "application/octet-stream",
        size=len(content),
        description=description,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/{file_id}/download")
def download_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = db.query(ClientFile).filter(ClientFile.id == file_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    # Access check
    if current_user.role != UserRole.admin:
        ids = current_user.client_ids
        allowed = ids[0] if ids else current_user.client_id
        if record.client_id != allowed:
            raise HTTPException(status_code=403, detail="Access denied")

    path = FILES_DIR / str(record.client_id) / record.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(path),
        media_type=record.mime_type,
        filename=record.filename,
    )


@router.delete("/{file_id}")
def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    record = db.query(ClientFile).filter(ClientFile.id == file_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    path = FILES_DIR / str(record.client_id) / record.stored_name
    if path.exists():
        path.unlink()

    db.delete(record)
    db.commit()
    return {"ok": True}
