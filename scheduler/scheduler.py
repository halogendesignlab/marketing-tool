"""scheduler.py — APScheduler cron jobs for all clients."""

import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from core.config_loader import load_all_clients, ClientConfig
from core.content_generator import (
    generate_social_captions_batch,
    generate_blog_draft,
    generate_gbp_post,
)
from core.drive_watcher import check_for_new_assets
from core.email_notifier import send_content_ready
from portal.api.database import SessionLocal
from portal.api.models import ContentItem, ContentType, ContentStatus, Platform, Asset

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


# ── Job functions ─────────────────────────────────────────────────────────────

def generate_social_captions_job(client_id: str):
    """Generate weekly social captions for all platforms and queue for approval."""
    from core.config_loader import load_client_config
    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        total = 0
        for platform in ["instagram", "facebook", "linkedin"]:
            captions = generate_social_captions_batch(config, platform, count=3)
            for caption in captions:
                item = ContentItem(
                    client_id=_get_db_client_id(db, client_id),
                    content_type=ContentType.social_caption,
                    platform=Platform(platform),
                    status=ContentStatus.pending_approval,
                    body=caption,
                )
                db.add(item)
                total += 1

        db.commit()
        logger.info(f"[{client_id}] Generated {total} social captions")

        # Notify client
        send_content_ready(
            to=config.notifications.client_email,
            brand_name=config.brand_name,
            count=total,
        )

    except Exception as e:
        logger.error(f"[{client_id}] Social caption generation failed: {e}")
        db.rollback()
    finally:
        db.close()


def generate_blog_draft_job(client_id: str):
    """Generate a monthly blog draft and queue for approval."""
    from core.config_loader import load_client_config
    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        draft = generate_blog_draft(config)
        item = ContentItem(
            client_id=_get_db_client_id(db, client_id),
            content_type=ContentType.blog_post,
            status=ContentStatus.pending_approval,
            title=draft["title"],
            body=draft["body"],
        )
        db.add(item)
        db.commit()
        logger.info(f"[{client_id}] Generated blog draft: {draft['title']}")

        send_content_ready(
            to=config.notifications.client_email,
            brand_name=config.brand_name,
            count=1,
        )

    except Exception as e:
        logger.error(f"[{client_id}] Blog draft generation failed: {e}")
        db.rollback()
    finally:
        db.close()


def generate_gbp_post_job(client_id: str):
    """Generate a GBP post and queue for approval."""
    from core.config_loader import load_client_config
    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        post = generate_gbp_post(config)
        item = ContentItem(
            client_id=_get_db_client_id(db, client_id),
            content_type=ContentType.gbp_post,
            platform=Platform.gbp,
            status=ContentStatus.pending_approval,
            body=post,
        )
        db.add(item)
        db.commit()
        logger.info(f"[{client_id}] Generated GBP post")

        send_content_ready(
            to=config.notifications.client_email,
            brand_name=config.brand_name,
            count=1,
        )

    except Exception as e:
        logger.error(f"[{client_id}] GBP post generation failed: {e}")
        db.rollback()
    finally:
        db.close()


def check_drive_assets_job(client_id: str):
    """Check Google Drive for new image assets and queue them."""
    from core.config_loader import load_client_config
    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        db_client_id = _get_db_client_id(db, client_id)

        # Get already-known Drive file IDs
        known = {
            a.drive_file_id for a in
            db.query(Asset.drive_file_id)
            .filter(Asset.client_id == db_client_id, Asset.drive_file_id.isnot(None))
            .all()
        }

        new_files = check_for_new_assets(config, known)

        for f in new_files:
            asset = Asset(
                client_id=db_client_id,
                filename=f["filename"],
                drive_file_id=f["drive_file_id"],
                local_path=f["local_path"],
                status="pending",
            )
            db.add(asset)

        db.commit()
        if new_files:
            logger.info(f"[{client_id}] Queued {len(new_files)} new assets from Drive")

    except Exception as e:
        logger.error(f"[{client_id}] Drive asset check failed: {e}")
        db.rollback()
    finally:
        db.close()


def publish_approved_content_job(client_id: str):
    """Publish all approved content that is due."""
    from core.config_loader import load_client_config
    from core.publer_publisher import publish_social_post, publish_gbp_post
    from core.webflow_publisher import publish_blog_post
    from core.email_notifier import send_publish_failure
    from datetime import datetime, timezone

    config = load_client_config(client_id)
    db = SessionLocal()
    now = datetime.now(timezone.utc)

    try:
        db_client_id = _get_db_client_id(db, client_id)
        items = db.query(ContentItem).filter(
            ContentItem.client_id == db_client_id,
            ContentItem.status == ContentStatus.approved,
            (ContentItem.scheduled_for <= now) | (ContentItem.scheduled_for.is_(None)),
        ).all()

        for item in items:
            try:
                item.status = ContentStatus.scheduled
                db.commit()

                if item.content_type == ContentType.social_caption and item.platform:
                    result = publish_social_post(
                        config=config,
                        body=item.body,
                        platforms=[item.platform.value],
                        image_url=item.image_url,
                        as_draft=False,
                    )
                    item.publer_post_id = str(result.get("job_id", ""))

                elif item.content_type == ContentType.gbp_post:
                    result = publish_gbp_post(
                        config=config,
                        body=item.body,
                        image_url=item.image_url,
                    )
                    item.publer_post_id = str(result.get("job_id", ""))

                elif item.content_type == ContentType.blog_post:
                    publish_blog_post(
                        config=config,
                        title=item.title or "Untitled",
                        body=item.body,
                        publish_immediately=True,
                    )

                item.status = ContentStatus.published
                item.published_at = now
                db.commit()
                logger.info(f"[{client_id}] Published content item {item.id} ({item.content_type})")

            except Exception as e:
                item.status = ContentStatus.failed
                item.error_message = str(e)
                item.retry_count += 1
                db.commit()
                logger.error(f"[{client_id}] Failed to publish item {item.id}: {e}")

                send_publish_failure(
                    to=config.notifications.admin_email,
                    brand_name=config.brand_name,
                    content_type=item.content_type.value,
                    platform=item.platform.value if item.platform else "unknown",
                    error=str(e),
                )

    except Exception as e:
        logger.error(f"[{client_id}] Publish job failed: {e}")
    finally:
        db.close()


# ── Scheduler setup ───────────────────────────────────────────────────────────

def register_client_jobs(config: ClientConfig):
    """Register all cron jobs for a single client."""
    cid = config.client_id
    sched = config.schedule

    # Social captions — every Monday at 06:00 UTC
    scheduler.add_job(
        generate_social_captions_job,
        CronTrigger(day_of_week="mon", hour=6, minute=0),
        args=[cid],
        id=f"{cid}_social_captions",
        replace_existing=True,
    )

    # Blog draft — 1st of each month at 07:00 UTC
    scheduler.add_job(
        generate_blog_draft_job,
        CronTrigger(day=1, hour=7, minute=0),
        args=[cid],
        id=f"{cid}_blog_draft",
        replace_existing=True,
    )

    # GBP posts — every 7 days (weekly), Monday at 08:00 UTC
    scheduler.add_job(
        generate_gbp_post_job,
        CronTrigger(day_of_week="mon", hour=8, minute=0),
        args=[cid],
        id=f"{cid}_gbp_post",
        replace_existing=True,
    )

    # Drive asset check — every 6 hours
    scheduler.add_job(
        check_drive_assets_job,
        CronTrigger(hour="*/6"),
        args=[cid],
        id=f"{cid}_drive_check",
        replace_existing=True,
    )

    # Publish approved content — every 15 minutes
    scheduler.add_job(
        publish_approved_content_job,
        CronTrigger(minute="*/15"),
        args=[cid],
        id=f"{cid}_publish",
        replace_existing=True,
    )

    logger.info(f"Registered jobs for client: {cid}")


def start_scheduler():
    """Load all clients and start the scheduler."""
    clients = load_all_clients()
    for config in clients:
        register_client_jobs(config)

    scheduler.start()
    logger.info(f"Scheduler started with {len(clients)} client(s)")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_db_client_id(db, client_id: str) -> int:
    from portal.api.models import Client
    client = db.query(Client).filter(Client.client_id == client_id).first()
    if not client:
        raise ValueError(f"Client '{client_id}' not found in database")
    return client.id
