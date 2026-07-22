"""report_generator.py — Compile monthly performance reports."""

import logging
from datetime import datetime, timezone
from .config_loader import ClientConfig
from .serp_tracker_localfalcon import compute_rank_trends
from .gsc_tracker import get_search_analytics
from portal.api.database import SessionLocal
from portal.api.models import (
    Report, ContentItem, ContentStatus, ContentType,
    Review, DirectoryListing, SerpResult, Client,
)

logger = logging.getLogger(__name__)


def generate_monthly_report(config: ClientConfig, month: int, year: int) -> dict:
    """Compile a monthly report and save to DB. Returns the report data dict."""
    db = SessionLocal()

    try:
        client = db.query(Client).filter(Client.client_id == config.client_id).first()
        if not client:
            raise ValueError(f"Client {config.client_id} not found in database")

        start = datetime(year, month, 1, tzinfo=timezone.utc)
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc)

        # ── Content ───────────────────────────────────────────────────────────
        published = db.query(ContentItem).filter(
            ContentItem.client_id == client.id,
            ContentItem.status == ContentStatus.published,
            ContentItem.published_at >= start,
            ContentItem.published_at < end,
        ).all()

        content_section = {
            "total_published": len(published),
            "social": len([c for c in published if c.content_type == ContentType.social_caption]),
            "blog": len([c for c in published if c.content_type == ContentType.blog_post]),
            "gbp": len([c for c in published if c.content_type == ContentType.gbp_post]),
        }

        # ── Reviews ───────────────────────────────────────────────────────────
        reviews = db.query(Review).filter(
            Review.client_id == client.id,
            Review.detected_at >= start,
            Review.detected_at < end,
        ).all()

        by_platform: dict[str, int] = {}
        for r in reviews:
            key = r.platform.value if hasattr(r.platform, "value") else str(r.platform)
            by_platform[key] = by_platform.get(key, 0) + 1

        avg_rating = None
        rated = [r.rating for r in reviews if r.rating is not None]
        if rated:
            avg_rating = round(sum(rated) / len(rated), 1)

        reviews_section = {
            "total_new": len(reviews),
            "responded": len([r for r in reviews if r.responded_at is not None]),
            "avg_rating": avg_rating,
            "by_platform": by_platform,
        }

        # ── Directory ─────────────────────────────────────────────────────────
        listings = db.query(DirectoryListing).filter(
            DirectoryListing.client_id == client.id,
        ).all()

        dir_section = {
            "total_checked": len(listings),
            "inconsistent": len([l for l in listings if l.is_consistent is False]),
            "by_directory": {
                l.directory: {"consistent": l.is_consistent, "issues": l.issues or []}
                for l in listings
            },
        }

        # ── SERP (latest stored results for this period) ──────────────────────
        serp_results = db.query(SerpResult).filter(
            SerpResult.client_id == client.id,
            SerpResult.period_year == year,
            SerpResult.period_month == month,
        ).all()

        prev_month = month - 1 if month > 1 else 12
        prev_year = year if month > 1 else year - 1

        serp_section = []
        for sr in serp_results:
            prev_serp = db.query(SerpResult).filter(
                SerpResult.client_id == client.id,
                SerpResult.keyword == sr.keyword,
                SerpResult.period_year == prev_year,
                SerpResult.period_month == prev_month,
            ).first()
            grid_with_trends = compute_rank_trends(
                sr.grid_data,
                prev_serp.grid_data if prev_serp else None,
            )
            serp_section.append({
                "keyword": sr.keyword,
                "grid_data": grid_with_trends,
            })

        # ── Organic rankings (DataForSEO — disabled, replaced by GSC) ────────
        organic_section = []

        # ── GSC Search Analytics ──────────────────────────────────────────────
        gsc_section = {}
        try:
            gsc_section = get_search_analytics(config, month, year)
        except Exception as e:
            logger.warning(f"[{config.client_id}] GSC analytics failed: {e}")

        # ── SERP history (Local Falcon) ───────────────────────────────────────
        serp_history: dict = {}
        lf = config.local_falcon
        if lf and lf.api_key and lf.place_id:
            try:
                from .serp_tracker_localfalcon import get_keyword_history
                now_ts = int(datetime.now(timezone.utc).timestamp())
                history_by_kw = get_keyword_history(lf.api_key, lf.place_id)

                def _find_comparison(scans: list, target_days: int) -> dict | None:
                    """Find scan closest to target_days ago, must be at least (target_days - 14) days old."""
                    min_age_secs = (target_days - 14) * 86400
                    candidates = [s for s in scans if (now_ts - s["timestamp"]) >= min_age_secs]
                    if not candidates:
                        return None
                    target_ts = now_ts - target_days * 86400
                    return min(candidates, key=lambda s: abs(s["timestamp"] - target_ts))

                for kw_data in serp_section:
                    kw = kw_data["keyword"]
                    scans = history_by_kw.get(kw, [])
                    if not scans:
                        continue
                    serp_history[kw] = {
                        "current": scans[0],
                        "30d":  _find_comparison(scans, 30),
                        "120d": _find_comparison(scans, 120),
                        "365d": _find_comparison(scans, 365),
                    }
            except Exception as e:
                logger.warning(f"[{config.client_id}] SERP history build failed: {e}")

        # ── Assemble ──────────────────────────────────────────────────────────
        data = {
            "content": content_section,
            "reviews": reviews_section,
            "directories": dir_section,
            "serp": serp_section,
            "serp_history": serp_history,
            "serp_organic": organic_section,
            "gsc": gsc_section,
        }

        # Upsert — replace existing report for same period if present
        existing = db.query(Report).filter(
            Report.client_id == client.id,
            Report.period_year == year,
            Report.period_month == month,
        ).first()

        now = datetime.now(timezone.utc)
        if existing:
            existing.data = data
            existing.generated_at = now
        else:
            db.add(Report(
                client_id=client.id,
                period_year=year,
                period_month=month,
                data=data,
                generated_at=now,
            ))

        db.commit()
        logger.info(f"[{config.client_id}] Report generated for {month}/{year}")
        return data

    except Exception as e:
        logger.error(f"[{config.client_id}] Report generation failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


def run_serp_checks(config: ClientConfig, month: int, year: int) -> None:
    """Run geo-grid SERP scans for all configured keywords and store results via Local Falcon."""
    # ── Local Falcon (preferred) ──────────────────────────────────────────────
    lf = config.local_falcon
    if lf and lf.api_key and lf.place_id:
        logger.info(f"[{config.client_id}] Using Local Falcon for SERP (place_id={lf.place_id})")
        _run_serp_checks_localfalcon(config, lf.api_key, lf.place_id, month, year)
        return

    logger.info(f"[{config.client_id}] No Local Falcon config — skipping SERP checks")


def _run_serp_checks_localfalcon(
    config: ClientConfig, api_key: str, place_id: str, month: int, year: int
) -> None:
    """Fetch grid data from Local Falcon and store in serp_results."""
    from .serp_tracker_localfalcon import get_latest_scans

    scans = get_latest_scans(api_key, place_id)
    if not scans:
        logger.warning(f"[{config.client_id}] Local Falcon returned no scans")
        return

    db = SessionLocal()
    try:
        client = db.query(Client).filter(Client.client_id == config.client_id).first()
        if not client:
            return

        for scan in scans:
            if not scan["grid_data"]:
                continue
            _upsert_serp_result(db, client.id, scan["keyword"], scan["grid_data"], year, month)

        db.commit()
        logger.info(
            f"[{config.client_id}] Local Falcon SERP checks stored: "
            f"{len(scans)} keyword(s) for {month}/{year}"
        )
    except Exception as e:
        logger.error(f"[{config.client_id}] Local Falcon SERP storage failed: {e}")
        db.rollback()
    finally:
        db.close()


def _upsert_serp_result(db, client_id: int, keyword: str, grid_data: list, year: int, month: int) -> None:
    """Insert or update a SerpResult row."""
    now = datetime.now(timezone.utc)
    existing = db.query(SerpResult).filter(
        SerpResult.client_id == client_id,
        SerpResult.keyword == keyword,
        SerpResult.period_year == year,
        SerpResult.period_month == month,
    ).first()

    if existing:
        existing.grid_data = grid_data
        existing.checked_at = now
    else:
        db.add(SerpResult(
            client_id=client_id,
            keyword=keyword,
            grid_data=grid_data,
            period_year=year,
            period_month=month,
            checked_at=now,
        ))
