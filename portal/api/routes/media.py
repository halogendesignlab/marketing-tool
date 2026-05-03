"""routes/media.py — Image upload."""

import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from ..auth import get_current_user
from ..models import User

UPLOADS_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

router = APIRouter()


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, and GIF images are allowed")

    ext = Path(file.filename or "image.jpg").suffix or ".jpg"
    unique_name = f"{uuid.uuid4().hex}{ext}"

    client_dir = UPLOADS_DIR / str(current_user.client_id or "admin")
    client_dir.mkdir(parents=True, exist_ok=True)

    dest = client_dir / unique_name
    content = await file.read()
    dest.write_bytes(content)

    return {"url": f"/uploads/{current_user.client_id or 'admin'}/{unique_name}"}
