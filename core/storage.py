"""storage.py — Cloudflare R2 object storage (S3-compatible).

Upload files to R2 and get back permanent public URLs.
Falls back to local /uploads/ if R2 is not configured.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def _r2_client():
    import boto3
    from portal.api.settings import get_settings
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def r2_configured() -> bool:
    from portal.api.settings import get_settings
    s = get_settings()
    return bool(s.R2_ACCOUNT_ID and s.R2_ACCESS_KEY_ID and s.R2_SECRET_ACCESS_KEY and s.R2_BUCKET_NAME)


def upload_bytes(data: bytes, key: str, mime_type: str = "image/jpeg") -> str:
    """Upload bytes to R2. Returns the public URL."""
    from portal.api.settings import get_settings
    settings = get_settings()

    client = _r2_client()
    client.put_object(
        Bucket=settings.R2_BUCKET_NAME,
        Key=key,
        Body=data,
        ContentType=mime_type,
    )

    public_url = f"{settings.R2_PUBLIC_URL.rstrip('/')}/{key}"
    logger.info(f"Uploaded to R2: {public_url}")
    return public_url


def upload_file(local_path: Path, key: str, mime_type: str = "image/jpeg") -> str:
    """Upload a local file to R2. Returns the public URL."""
    data = local_path.read_bytes()
    return upload_bytes(data, key, mime_type)
