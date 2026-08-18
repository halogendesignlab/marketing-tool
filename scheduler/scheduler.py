"""scheduler.py — APScheduler cron jobs for all clients."""

import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from core.config_loader import load_all_clients, ClientConfig
from core.content_generator import (
    generate_blog_draft,
    generate_captions_from_image,
    recent_blog_titles,
)
from core.email_notifier import send_content_ready
from portal.api.database import SessionLocal
from portal.api.models import ContentItem, ContentType, ContentStatus, Platform, MediaItem

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


# ── Job functions ─────────────────────────────────────────────────────────────

def generate_social_captions_job(client_id: str):
    """Generate weekly social posts from media library using Claude vision."""
    from core.config_loader import load_client_config
    from datetime import datetime, timezone

    config = load_client_config(client_id)
    db = SessionLocal()

    try:
        db_client_id = _get_db_client_id(db, client_id)

        media_item = _next_photo(db, config, db_client_id)

        if not media_item:
            logger.warning(
                f"[{client_id}] No media items in library"
                + (f" for category '{config.media_category}'" if config.media_category else "")
                + " — skipping weekly captions"
            )
            return

        captions = generate_captions_from_image(
            config=config,
            image_path=media_item.url,
            image_filename=media_item.filename,
            image_meta=media_item.meta,
        )

        platform_map = {
            "instagram": Platform.instagram,
            "facebook": Platform.facebook,
            "linkedin": Platform.linkedin,
            "gbp": Platform.gbp,
        }

        total = 0
        for platform_key, platform_enum in platform_map.items():
            caption_text = captions.get(platform_key, "")
            if not caption_text:
                continue
            item = ContentItem(
                client_id=db_client_id,
                content_type=ContentType.social_caption,
                platform=platform_enum,
                status=ContentStatus.pending_approval,
                body=caption_text,
                image_url=media_item.url,
            )
            db.add(item)
            total += 1

        media_item.last_used_at = datetime.now(timezone.utc)
        db.commit()
        logger.info(f"[{client_id}] Generated {total} platform captions from image {media_item.filename}")

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
        db_client_id = _get_db_client_id(db, client_id)
        draft = generate_blog_draft(
            config,
            recent_titles=recent_blog_titles(db, db_client_id),
        )
        item = ContentItem(
            client_id=db_client_id,
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


# A standalone weekly GBP post job used to live here. It was removed: the weekly
# caption job already writes a GBP caption for the photo it selects, so the two
# produced a duplicate GBP update every Monday — and this one had no photo, no
# keyword context and no memory of previous posts. Admins can still generate a
# one-off GBP post from the portal, which calls generate_gbp_post directly.


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

def _monthly_days(count: int) -> str:
    """Day-of-month cron spec spreading `count` runs evenly across the month.

    Capped at the 28th so every month fires the same number of times — a run
    pinned to the 30th silently never happens in February.
    """
    count = max(1, min(count, 28))
    days = sorted({1 + round(i * 28 / count) for i in range(count)})
    return ",".join(str(d) for d in days)


def register_client_jobs(config: ClientConfig):
    """Register all cron jobs for a single client."""
    cid = config.client_id
    sched = config.schedule  # noqa: F841 — used below for day-of-month settings

    # Social captions — every Monday at 06:00 UTC
    scheduler.add_job(
        generate_social_captions_job,
        CronTrigger(day_of_week="mon", hour=6, minute=0),
        args=[cid],
        id=f"{cid}_social_captions",
        replace_existing=True,
    )

    # Blog drafts — spread across the month per the client's contracted volume
    scheduler.add_job(
        generate_blog_draft_job,
        CronTrigger(day=_monthly_days(sched.blog_posts_per_month), hour=7, minute=0),
        args=[cid],
        id=f"{cid}_blog_draft",
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


def _media_client_id(db, db_client_id: int) -> int:
    """Which client's library to draw photos from.

    A client can delegate its media to a sibling via media_source_client_id —
    the portal's media routes already honour this, and the scheduler has to
    agree or a delegating client silently finds no photos at all.
    """
    from portal.api.models import Client
    client = db.query(Client).filter(Client.id == db_client_id).first()
    if client and client.media_source_client_id:
        return client.media_source_client_id
    return db_client_id


def _next_photo(db, config: ClientConfig, db_client_id: int):
    """A random photo this client may post, chosen from ones not already used.

    "Used" is measured by whether a content item still points at the photo,
    rather than by a timestamp. That distinction matters: photos are claimed at
    generation time, so if a draft is discarded before it ever publishes, the
    row goes away and the photo returns to the pool by itself.

    When brands share a library, media_category keeps each one to its own work.
    """
    from sqlalchemy import func, nullsfirst

    q = db.query(MediaItem).filter(MediaItem.client_id == _media_client_id(db, db_client_id))
    if config.media_category:
        # JSON accessor rather than json_extract — the latter does not exist on Postgres.
        q = q.filter(MediaItem.meta["category"].as_string() == config.media_category)

    claimed = db.query(ContentItem.image_url).filter(ContentItem.image_url.isnot(None))
    photo = q.filter(MediaItem.url.notin_(claimed)).order_by(func.random()).first()
    if photo:
        return photo

    # Exhausted — every eligible photo is already spoken for. Reuse the one that
    # has sat unused the longest rather than going quiet.
    logger.warning(
        f"[{config.client_id}] Every eligible photo has been used"
        + (f" in category '{config.media_category}'" if config.media_category else "")
        + " — falling back to the least recently used"
    )
    return q.order_by(nullsfirst(MediaItem.last_used_at.asc())).first()
