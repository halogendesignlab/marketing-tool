"""media_rotation.py — Which photo a client should post next.

Shared by the scheduler's GBP gallery job and the portal's on-demand generation,
so both draw from the same rotation and cannot hand out the same photo twice.
Lives in core rather than scheduler/ so importing it does not drag APScheduler
into the API process.
"""

import logging

from sqlalchemy import func, nullsfirst

from core.config_loader import ClientConfig

logger = logging.getLogger(__name__)

# Marks a photo as already sent to the GBP gallery. Lives in MediaItem.meta so it
# survives without a schema change.
GBP_GALLERY_KEY = "gbp_gallery_at"


def media_client_id(db, db_client_id: int) -> int:
    """Which client's library to draw photos from.

    A client can delegate its media to a sibling via media_source_client_id —
    the portal's media routes already honour this, and generation has to agree
    or a delegating client silently finds no photos at all.
    """
    from portal.api.models import Client

    client = db.query(Client).filter(Client.id == db_client_id).first()
    if client and client.media_source_client_id:
        return client.media_source_client_id
    return db_client_id


def eligible_photos(db, config: ClientConfig, db_client_id: int):
    """Query of photos this client may still post.

    "Used" is measured by whether a content item points at the photo, rather
    than by a timestamp. That distinction matters: photos are claimed when a
    draft is generated, so if the draft is discarded before it ever publishes,
    the row goes away and the photo returns to the pool by itself.

    When brands share a library, media_category keeps each one to its own work.
    """
    from portal.api.models import ContentItem, MediaItem

    q = db.query(MediaItem).filter(MediaItem.client_id == media_client_id(db, db_client_id))
    if config.media_category:
        # JSON accessor rather than json_extract — the latter does not exist on Postgres.
        q = q.filter(MediaItem.meta["category"].as_string() == config.media_category)

    claimed = db.query(ContentItem.image_url).filter(ContentItem.image_url.isnot(None))
    return q.filter(
        MediaItem.url.notin_(claimed),
        # Gallery uploads leave no content item behind, so they record themselves
        # on the photo. Unlike a draft, one cannot be discarded — it is already
        # on the profile — so this marker is deliberately permanent.
        MediaItem.meta[GBP_GALLERY_KEY].as_string().is_(None),
    )


def next_photo(db, config: ClientConfig, db_client_id: int):
    """One random unused photo, or the least recently used once none are left."""
    photo = eligible_photos(db, config, db_client_id).order_by(func.random()).first()
    if photo:
        return photo

    logger.warning(
        f"[{config.client_id}] Every eligible photo has been used"
        + (f" in category '{config.media_category}'" if config.media_category else "")
        + " — falling back to the least recently used"
    )
    from portal.api.models import MediaItem

    q = db.query(MediaItem).filter(MediaItem.client_id == media_client_id(db, db_client_id))
    if config.media_category:
        q = q.filter(MediaItem.meta["category"].as_string() == config.media_category)
    return q.order_by(nullsfirst(MediaItem.last_used_at.asc())).first()


def next_photos(db, config: ClientConfig, db_client_id: int, count: int) -> list:
    """`count` distinct unused photos, fewest-first if the pool is short.

    Taken in one query rather than by calling next_photo repeatedly, since
    nothing has claimed them yet and repeated calls could return the same photo.
    """
    photos = eligible_photos(db, config, db_client_id).order_by(func.random()).limit(count).all()
    if len(photos) < count:
        logger.warning(
            f"[{config.client_id}] Asked for {count} photos, only {len(photos)} unused"
            + (f" in category '{config.media_category}'" if config.media_category else "")
        )
    return photos
