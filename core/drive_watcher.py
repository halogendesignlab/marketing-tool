"""drive_watcher.py — Watch a Google Drive folder for new image assets."""

import os
import tempfile
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from .config_loader import ClientConfig
from portal.api.settings import get_settings

settings = get_settings()

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
SUPPORTED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif"
}

ASSETS_DIR = Path(__file__).parent.parent / "assets"


def _drive_service():
    creds = service_account.Credentials.from_service_account_file(
        settings.GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=SCOPES,
    )
    return build("drive", "v3", credentials=creds)


def list_new_files(config: ClientConfig, known_file_ids: set[str]) -> list[dict]:
    """Return files in the client's Drive folder that aren't in known_file_ids."""
    if not config.drive:
        return []

    service = _drive_service()
    folder_id = config.drive.asset_folder_id

    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        fields="files(id, name, mimeType, createdTime)",
        orderBy="createdTime desc",
        pageSize=50,
    ).execute()

    files = results.get("files", [])
    return [
        f for f in files
        if f["id"] not in known_file_ids
        and f.get("mimeType") in SUPPORTED_MIME_TYPES
    ]


def download_file(file_id: str, filename: str, client_id: str) -> str:
    """Download a Drive file to local assets directory. Returns local path."""
    service = _drive_service()

    dest_dir = ASSETS_DIR / client_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / filename

    request = service.files().get_media(fileId=file_id)
    with open(dest_path, "wb") as f:
        downloader = MediaIoBaseDownload(f, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

    return str(dest_path)


def check_for_new_assets(config: ClientConfig, known_file_ids: set[str]) -> list[dict]:
    """
    Check Drive folder for new images. Downloads them locally.
    Returns list of {drive_file_id, filename, local_path} for each new file.
    """
    new_files = list_new_files(config, known_file_ids)
    results = []

    for f in new_files:
        try:
            local_path = download_file(f["id"], f["name"], config.client_id)
            results.append({
                "drive_file_id": f["id"],
                "filename": f["name"],
                "local_path": local_path,
            })
        except Exception as e:
            print(f"[drive_watcher] Failed to download {f['name']}: {e}")

    return results
