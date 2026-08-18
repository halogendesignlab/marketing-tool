"""drive_watcher.py — Sync image metadata from Google Drive into the media library.

Images are resized to 1080px max on the longest edge before uploading to R2,
keeping storage small and grid loads fast. Files are fetched from Drive using
a service account and uploaded in parallel using a thread pool.
"""

import io
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

from .config_loader import ClientConfig
from portal.api.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
SUPPORTED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
}
SKIP_FOLDER_KEYWORDS = ["not allowed", "do not use", "do not post"]

# Resize images to this max dimension before uploading (1080px = ideal for social media)
MAX_IMAGE_DIMENSION = 1080
UPLOAD_WORKERS = 8


def _drive_service():
    creds = service_account.Credentials.from_service_account_file(
        settings.GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=SCOPES,
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _list_all_images(service, folder_id: str, folder_path: list[str] | None = None) -> list[dict]:
    """Recursively list all image files, tracking folder path for metadata."""
    if folder_path is None:
        folder_path = []

    images = []

    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        fields="files(id, name, mimeType, size)",
        pageSize=100,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()

    for f in results.get("files", []):
        if f["mimeType"] == "application/vnd.google-apps.folder":
            name_lower = f["name"].lower()
            if any(kw in name_lower for kw in SKIP_FOLDER_KEYWORDS):
                logger.info(f"Skipping restricted folder: {f['name']}")
                continue
            images.extend(_list_all_images(service, f["id"], folder_path + [f["name"]]))
        elif f.get("mimeType") in SUPPORTED_MIME_TYPES:
            f["_folder_path"] = folder_path  # attach path to file dict
            images.append(f)

    return images


def _extract_metadata(folder_path: list[str]) -> dict:
    """Derive structured metadata from the Drive folder path.

    Expected structures:
      [category]                          → Houses/Commercial/Employees
      [category, project]                 → Houses/Harvard Oaks
      [category, project, photo_type]     → Houses/Harvard Oaks/Twilight Aerials
    """
    meta: dict = {}
    if not folder_path:
        return meta

    meta["folder_path"] = "/".join(folder_path)

    # First segment = category
    if len(folder_path) >= 1:
        meta["category"] = folder_path[0]

    # Second segment = project / subdivision / business name
    if len(folder_path) >= 2:
        meta["project"] = folder_path[1]

    # Third segment = photo type (Aerial, Twilight, Interior, MLS Size, etc.)
    if len(folder_path) >= 3:
        meta["photo_type"] = folder_path[2]

    return meta


def _resize_image(image_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
    """Resize image to MAX_IMAGE_DIMENSION on longest edge. Returns (bytes, mime_type)."""
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))

    # Convert RGBA/P to RGB for JPEG output
    if img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
        mime_type = "image/jpeg"

    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIMENSION:
        if w >= h:
            new_w = MAX_IMAGE_DIMENSION
            new_h = int(h * MAX_IMAGE_DIMENSION / w)
        else:
            new_h = MAX_IMAGE_DIMENSION
            new_w = int(w * MAX_IMAGE_DIMENSION / h)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    out = io.BytesIO()
    fmt = "JPEG" if mime_type in ("image/jpeg", "image/jpg") else "PNG" if mime_type == "image/png" else "WEBP"
    if fmt == "JPEG":
        img.save(out, format="JPEG", quality=88, optimize=True)
    else:
        img.save(out, format=fmt, optimize=True)

    return out.getvalue(), mime_type


def get_file_bytes(file_id: str) -> tuple[bytes, str]:
    """Download a Drive file's bytes on demand. Returns (bytes, mime_type)."""
    from googleapiclient.http import MediaIoBaseDownload

    service = _drive_service()
    meta = service.files().get(
        fileId=file_id,
        fields="mimeType",
        supportsAllDrives=True,
    ).execute()
    mime_type = meta.get("mimeType", "image/jpeg")

    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    return buf.getvalue(), mime_type


def _fetch_and_upload(
    file_info: dict,
    client_id_str: str,
) -> dict | None:
    """Worker: download from Drive, resize, upload to R2. Returns result dict or None on error."""
    from core.storage import upload_bytes

    file_id = file_info["id"]
    filename = file_info["name"]
    folder_path = file_info.get("_folder_path", [])
    meta = _extract_metadata(folder_path)

    try:
        # Each worker creates its own Drive service (not thread-safe to share)
        image_bytes, mime_type = get_file_bytes(file_id)
        resized_bytes, mime_type = _resize_image(image_bytes, mime_type)
        key = f"{client_id_str}/{filename}"
        url = upload_bytes(resized_bytes, key, mime_type)

        project = meta.get("project", "")
        logger.info(f"[{client_id_str}] Imported: {filename}{f' ({project})' if project else ''}")

        return {
            "filename": filename,
            "url": url,
            "mime_type": mime_type,
            "size": len(resized_bytes),
            "meta": meta if meta else None,
        }
    except Exception as e:
        logger.error(f"[{client_id_str}] Failed to import '{filename}': {e}")
        return None


def _classify_drive_files(
    client_id: str,
    drive_files: list[dict],
    existing_urls: set,
    existing_filenames: set,
    filename_to_meta: dict,
) -> tuple[list[dict], list[tuple[str, dict]]]:
    """Split a Drive scan into files to import and existing files needing metadata.

    At most one file per filename is imported. The recursive scan returns a photo
    once per folder it is filed in, and the R2 key is only client/filename, so
    without this two copies import as two rows pointing at one object — which is
    how the library came to hold 108 duplicates.

    Where copies collide the filed one wins over an unfiled one: folder-derived
    category is what keeps each brand posting its own work, so letting an unfiled
    copy win would quietly drop the photo out of rotation.
    """
    chosen: dict[str, dict] = {}
    to_backfill: list[tuple[str, dict]] = []

    for f in drive_files:
        filename = f["name"]
        meta = _extract_metadata(f.get("_folder_path", []))

        if f"drive://{f['id']}" in existing_urls or filename in existing_filenames:
            if filename_to_meta.get(filename) is None and meta:
                to_backfill.append((filename, meta))
            continue

        kept = chosen.get(filename)
        if kept is None:
            chosen[filename] = f
            continue

        # Keep whichever copy carries metadata; on a tie the first one stays.
        loser = f if _extract_metadata(kept.get("_folder_path", [])) or not meta else kept
        if loser is kept:
            chosen[filename] = f
        logger.warning(
            f"[{client_id}] '{filename}' appears more than once in Drive — keeping "
            f"{'/'.join(chosen[filename].get('_folder_path', [])) or 'unfiled'}, skipping "
            f"{'/'.join(loser.get('_folder_path', [])) or 'unfiled'}"
        )

    return list(chosen.values()), to_backfill


def sync_drive_to_media_library(config: ClientConfig, db_client_id: int, db) -> int:
    """
    Sync Drive images into the MediaItem table, resizing to 1080px and uploading to R2.
    Uses a thread pool for parallel downloads/uploads.
    Returns the number of newly imported images.
    """
    from portal.api.models import MediaItem

    if not config.drive or not config.drive.asset_folder_id:
        logger.debug(f"[{config.client_id}] No Drive folder configured — skipping sync")
        return 0

    if not settings.GOOGLE_SERVICE_ACCOUNT_FILE:
        logger.warning(f"[{config.client_id}] No service account file configured")
        return 0

    if not Path(settings.GOOGLE_SERVICE_ACCOUNT_FILE).exists():
        logger.warning(f"[{config.client_id}] Service account file not found")
        return 0

    folder_id = config.drive.asset_folder_id

    try:
        service = _drive_service()
        drive_files = _list_all_images(service, folder_id)
    except Exception as e:
        logger.error(f"[{config.client_id}] Failed to list Drive folder: {e}")
        return 0

    logger.info(f"[{config.client_id}] Drive scan found {len(drive_files)} image(s)")

    # Build sets for deduplication — check both drive:// proxy and R2 https:// filenames
    existing_rows = db.query(MediaItem.url, MediaItem.filename, MediaItem.meta).filter(
        MediaItem.client_id == db_client_id
    ).all()
    existing_urls = {row.url for row in existing_rows}
    existing_filenames = {row.filename for row in existing_rows}
    filename_to_meta = {row.filename: row.meta for row in existing_rows}

    from core.storage import r2_configured
    use_r2 = r2_configured()
    if not use_r2:
        logger.warning(f"[{config.client_id}] R2 not configured — falling back to drive:// proxy mode (no parallelism)")
        return _sync_proxy_mode(config, db_client_id, db, drive_files, existing_urls, existing_filenames)

    logger.info(f"[{config.client_id}] R2 configured — uploading with {UPLOAD_WORKERS} parallel workers (resize to {MAX_IMAGE_DIMENSION}px)")

    to_import, to_backfill = _classify_drive_files(
        config.client_id, drive_files, existing_urls, existing_filenames, filename_to_meta
    )

    logger.info(f"[{config.client_id}] {len(to_import)} to import, {len(to_backfill)} to backfill metadata, {len(drive_files) - len(to_import) - len(to_backfill)} already up to date")

    # Backfill metadata for existing items (sequential, fast)
    meta_updated = 0
    for filename, meta in to_backfill:
        try:
            existing_item = db.query(MediaItem).filter(
                MediaItem.client_id == db_client_id,
                MediaItem.filename == filename,
            ).first()
            if existing_item and existing_item.meta is None:
                existing_item.meta = meta
                db.commit()
                meta_updated += 1
        except Exception as e:
            logger.warning(f"[{config.client_id}] Could not backfill meta for '{filename}': {e}")
            db.rollback()

    if meta_updated:
        logger.info(f"[{config.client_id}] Backfilled metadata on {meta_updated} existing item(s)")

    # Parallel upload
    new_count = 0
    db_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as executor:
        futures = {
            executor.submit(_fetch_and_upload, f, config.client_id): f
            for f in to_import
        }
        for future in as_completed(futures):
            result = future.result()
            if result is None:
                continue
            # DB insert on main thread under lock
            with db_lock:
                try:
                    item = MediaItem(
                        client_id=db_client_id,
                        filename=result["filename"],
                        url=result["url"],
                        mime_type=result["mime_type"],
                        size=result["size"],
                        meta=result["meta"],
                    )
                    db.add(item)
                    db.commit()
                    new_count += 1
                except Exception as e:
                    logger.error(f"[{config.client_id}] DB insert failed for '{result['filename']}': {e}")
                    db.rollback()

    logger.info(f"[{config.client_id}] Imported {new_count} new Drive photo(s)")
    return new_count


def _sync_proxy_mode(
    config: ClientConfig,
    db_client_id: int,
    db,
    drive_files: list[dict],
    existing_urls: set,
    existing_filenames: set,
) -> int:
    """Fallback: store drive:// URLs without uploading (no R2)."""
    from portal.api.models import MediaItem

    new_count = 0
    for f in drive_files:
        file_id = f["id"]
        drive_url = f"drive://{file_id}"
        filename = f["name"]
        folder_path = f.get("_folder_path", [])
        meta = _extract_metadata(folder_path)

        if drive_url in existing_urls or filename in existing_filenames:
            continue

        try:
            item = MediaItem(
                client_id=db_client_id,
                filename=filename,
                url=drive_url,
                mime_type=f.get("mimeType", "image/jpeg"),
                size=int(f.get("size", 0)),
                meta=meta if meta else None,
            )
            db.add(item)
            db.commit()
            new_count += 1
            logger.info(f"[{config.client_id}] Imported (proxy): {filename}")
        except Exception as e:
            logger.error(f"[{config.client_id}] Failed to import '{filename}': {e}")
            db.rollback()

    logger.info(f"[{config.client_id}] Imported {new_count} new Drive photo(s) (proxy mode)")
    return new_count
