"""scheduler.py — APScheduler cron jobs for all clients."""

import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from core.config_loader import load_all_clients, ClientConfig
from core.media_rotation import GBP_GALLERY_KEY, next_photo
from portal.api.database import SessionLocal
from portal.api.models import ContentItem, ContentType, ContentStatus

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


# ── Job functions ─────────────────────────────────────────────────────────────

# Content generation is no longer scheduled. Blog posts and social captions are
# produced on demand from the portal — see the generate endpoints in
# portal/api/routes/approvals.py. The GBP gallery upload below is the only
# content the scheduler still creates by itself.


def upload_gbp_photo_job(client_id: str):
    """Add one photo to the client's Google Business Profile gallery.

    Google is deliberately not part of the weekly caption run. It gets a gallery
    photo rather than an Update, so this draws from the same rotation and posts
    the image on its own.
    """
    from core.config_loader import load_client_config
    from core.publer_publisher import upload_gbp_photo
    from datetime import datetime, timezone

    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        db_client_id = _get_db_client_id(db, client_id)
        photo = next_photo(db, config, db_client_id)
        if not photo:
            logger.warning(f"[{client_id}] No eligible photo — skipping GBP gallery upload")
            return

        # Google shows this as the photo's description. The project name is the
        # only text here; there is no caption to write.
        description = (photo.meta or {}).get("project") or ""
        upload_gbp_photo(config, image_url=photo.url, description=description)

        now = datetime.now(timezone.utc)
        photo.last_used_at = now
        # Reassign rather than mutate — SQLAlchemy does not track in-place edits
        # to a JSON column, so a mutated dict would never persist.
        photo.meta = {**(photo.meta or {}), GBP_GALLERY_KEY: now.isoformat()}
        db.commit()
        logger.info(f"[{client_id}] Uploaded {photo.filename} to GBP gallery")

    except Exception as e:
        logger.error(f"[{client_id}] GBP gallery upload failed: {e}")
        db.rollback()
    finally:
        db.close()


# A standalone weekly GBP *post* job used to live here, writing a text-only
# Update. It was removed: it duplicated the caption job's GBP output, and Google
# now gets a gallery photo instead. Admins can still generate a one-off GBP post
# from the portal, which calls generate_gbp_post directly.


def auto_publish_expired_reviews_job(client_id: str):
    """Approve client_review items whose review window has closed."""
    from datetime import datetime, timezone

    db = SessionLocal()
    now = datetime.now(timezone.utc)
    try:
        db_client_id = _get_db_client_id(db, client_id)
        items = db.query(ContentItem).filter(
            ContentItem.client_id == db_client_id,
            ContentItem.status == ContentStatus.client_review,
            ContentItem.auto_publish_at.isnot(None),
            ContentItem.auto_publish_at <= now,
        ).all()

        for item in items:
            item.status = ContentStatus.approved
            item.approved_at = now
            item.auto_publish_at = None
            logger.info(f"[{client_id}] Review window closed — auto-approved item {item.id}")
        if items:
            db.commit()
    except Exception as e:
        logger.error(f"[{client_id}] auto_publish_expired_reviews_job failed: {e}")
    finally:
        db.close()


def publish_approved_content_job(client_id: str):
    """Publish all approved content that is due."""
    from core.config_loader import load_client_config
    from core.publer_publisher import publish_social_post, publish_gbp_post
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
                        scheduled_for=item.scheduled_for,
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
                    # Blog posts are approved in the portal for reference — no external publisher
                    pass

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


def sync_drive_media_job(client_id: str):
    """Sync new photos from Google Drive into the media library."""
    from core.config_loader import load_client_config
    from core.drive_watcher import sync_drive_to_media_library

    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        db_client_id = _get_db_client_id(db, client_id)
        new_count = sync_drive_to_media_library(config, db_client_id, db)
        if new_count:
            logger.info(f"[{client_id}] Drive sync complete — {new_count} new photo(s) imported")
        else:
            logger.debug(f"[{client_id}] Drive sync — no new photos")
    except Exception as e:
        logger.error(f"[{client_id}] Drive sync job failed: {e}")
        db.rollback()
    finally:
        db.close()


def check_reviews_job(client_id: str):
    """Fetch reviews, save new ones, and auto-mark responded if owner reply detected."""
    from core.config_loader import load_client_config
    from core.review_monitor import fetch_all_reviews
    from core.email_notifier import send_review_alert
    from portal.api.models import Review, ReviewPlatform
    from datetime import datetime, timezone

    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        db_client_id = _get_db_client_id(db, client_id)

        existing = {
            r.external_id: r for r in
            db.query(Review).filter(Review.client_id == db_client_id).all()
        }

        all_reviews = fetch_all_reviews(config)
        new_count = 0

        for r in all_reviews:
            external_id = r["external_id"]
            has_response = r.get("has_owner_response", False)

            if external_id in existing:
                # Update responded_at if owner reply now detected
                review = existing[external_id]
                if has_response and review.responded_at is None:
                    review.responded_at = datetime.now(timezone.utc)
                    db.commit()
                    logger.info(f"[{client_id}] Marked review {external_id} as responded")
                continue

            # New review
            try:
                platform_enum = ReviewPlatform(r["platform"])
            except ValueError:
                continue

            review = Review(
                client_id=db_client_id,
                platform=platform_enum,
                external_id=external_id,
                reviewer_name=r.get("reviewer_name"),
                rating=r.get("rating"),
                body=r.get("body"),
                responded_at=datetime.now(timezone.utc) if has_response else None,
            )
            db.add(review)
            db.commit()
            new_count += 1

            if not has_response:
                try:
                    send_review_alert(
                        to=config.notifications.admin_email,
                        brand_name=config.brand_name,
                        platform=r["platform"],
                        rating=r.get("rating"),
                    )
                except Exception:
                    pass

        logger.info(f"[{client_id}] Review check done — {new_count} new review(s)")

    except Exception as e:
        logger.error(f"[{client_id}] Review check job failed: {e}")
        db.rollback()
    finally:
        db.close()


def run_serp_checks_job(client_id: str):
    """Run geo-grid SERP scans and store results."""
    from core.config_loader import load_client_config
    from core.report_generator import run_serp_checks
    from datetime import datetime, timezone

    config = load_client_config(client_id)
    now = datetime.now(timezone.utc)
    try:
        run_serp_checks(config, now.month, now.year)
    except Exception as e:
        logger.error(f"[{client_id}] SERP checks job failed: {e}")


def generate_report_job(client_id: str):
    """Generate the monthly report (runs after SERP checks on the same day)."""
    from core.config_loader import load_client_config
    from core.report_generator import generate_monthly_report
    from core.email_notifier import send_report_ready
    from datetime import datetime, timezone

    config = load_client_config(client_id)
    now = datetime.now(timezone.utc)
    # Report covers the previous month
    month = now.month - 1 if now.month > 1 else 12
    year = now.year if now.month > 1 else now.year - 1

    try:
        generate_monthly_report(config, month, year)
        try:
            send_report_ready(
                to=config.notifications.admin_email,
                brand_name=config.brand_name,
                month=month,
                year=year,
            )
        except Exception:
            pass
    except Exception as e:
        logger.error(f"[{client_id}] Report generation job failed: {e}")


# ── Scheduler setup ───────────────────────────────────────────────────────────

def register_client_jobs(config: ClientConfig):
    """Register all cron jobs for a single client."""
    cid = config.client_id
    sched = config.schedule  # noqa: F841 — used below for day-of-month settings



    # GBP gallery photo — Mondays at 08:00 UTC. Runs after the caption job so that
    # job's photo is already claimed and cannot be picked again here.
    scheduler.add_job(
        upload_gbp_photo_job,
        CronTrigger(day_of_week="mon", hour=8, minute=0),
        args=[cid],
        id=f"{cid}_gbp_photo",
        replace_existing=True,
    )

    # Close expired client review windows — hourly, just before the publish sweep
    scheduler.add_job(
        auto_publish_expired_reviews_job,
        CronTrigger(minute=10),
        args=[cid],
        id=f"{cid}_auto_publish_expired",
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

    # Drive media sync — every 6 hours (only runs if drive folder is configured)
    scheduler.add_job(
        sync_drive_media_job,
        CronTrigger(hour="*/6", minute=30),
        args=[cid],
        id=f"{cid}_drive_sync",
        replace_existing=True,
    )

    # Review check — every N hours (configurable); use interval trigger to avoid cron hour-range limits
    from apscheduler.triggers.interval import IntervalTrigger
    scheduler.add_job(
        check_reviews_job,
        IntervalTrigger(hours=sched.review_check_interval_hours),
        args=[cid],
        id=f"{cid}_reviews",
        replace_existing=True,
    )

    # SERP geo-grid scan — configurable day of month at 02:00 UTC
    scheduler.add_job(
        run_serp_checks_job,
        CronTrigger(day=sched.serp_check_day_of_month, hour=2, minute=0),
        args=[cid],
        id=f"{cid}_serp",
        replace_existing=True,
    )

    # Monthly report — configurable day of month at 03:00 UTC
    scheduler.add_job(
        generate_report_job,
        CronTrigger(day=sched.report_day_of_month, hour=3, minute=0),
        args=[cid],
        id=f"{cid}_report",
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
