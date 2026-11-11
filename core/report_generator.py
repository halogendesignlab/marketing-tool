"""report_generator.py — Compile monthly performance reports."""

import logging
from datetime import datetime, timezone
from .config_loader import ClientConfig
from .serp_tracker_localfalcon import attach_baseline_ranks, compute_rank_trends
from .gsc_tracker import get_search_analytics, get_site_totals_for_month
from portal.api.database import SessionLocal
from portal.api.models import (
    Report, ContentItem, ContentStatus, ContentType,
    Review, DirectoryListing, SerpResult, Client,
)

logger = logging.getLogger(__name__)


def generate_monthly_report(
    config: ClientConfig,
    month: int,
    year: int,
    label_month: int | None = None,
    label_year: int | None = None,
) -> dict:
    """Compile a monthly report and save to DB. Returns the report data dict.

    `month`/`year` set the window the data is measured over. `label_month`/
    `label_year` set the period the report is filed under, and default to the
    measured month. They differ because reports are named for the month they go
    out in rather than the month they cover: the report produced on 1 December
    measures November and is filed as December.
    """
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
        # Scans are keyed by the month they were taken in, and a keyword is not
        # necessarily scanned every month. Each report shows the most recent
        # scan at or before its period, carrying one forward when there is
        # nothing newer — labelled with the date it was actually taken, and
        # flagged so the page can say the figure is not from this month.
        period_key = year * 12 + month
        month_key = SerpResult.period_year * 12 + SerpResult.period_month

        def _scan_at_or_before(keyword: str, before_key: int) -> SerpResult | None:
            return db.query(SerpResult).filter(
                SerpResult.client_id == client.id,
                SerpResult.keyword == keyword,
                month_key <= before_key,
            ).order_by(month_key.desc(), SerpResult.id.desc()).first()

        def _first_scan_for(keyword: str) -> SerpResult | None:
            """A keyword's own earliest scan. The tracked set changes over time,
            so a keyword added later has no data at the client-wide baseline."""
            return db.query(SerpResult).filter(
                SerpResult.client_id == client.id,
                SerpResult.keyword == keyword,
            ).order_by(month_key, SerpResult.id).first()

        # Ordered by keyword so the map packs appear in the same sequence in
        # every report. Without an explicit order the database returns these
        # rows however it likes, and that order can change between runs — so a
        # client comparing two months found the same keywords in new positions.
        tracked = sorted(
            k for (k,) in db.query(SerpResult.keyword)
            .filter(SerpResult.client_id == client.id).distinct().all()
        )

        # The engagement baseline: the earliest scan on record for this client.
        baseline = db.query(SerpResult).filter(
            SerpResult.client_id == client.id,
        ).order_by(month_key, SerpResult.id).first()
        baseline_year = baseline.period_year if baseline else None
        baseline_month = baseline.period_month if baseline else None
        # A baseline that is the month being reported is not a comparison.
        if (baseline_year, baseline_month) == (year, month):
            baseline_year = baseline_month = None

        serp_section = []
        for keyword in tracked:
            sr = _scan_at_or_before(keyword, period_key)
            if not sr:
                continue  # first scanned after this report's period

            sr_key = sr.period_year * 12 + sr.period_month
            # The scan before the one being shown, whenever that was taken.
            prev_serp = _scan_at_or_before(keyword, sr_key - 1)
            grid_with_trends = compute_rank_trends(
                sr.grid_data,
                prev_serp.grid_data if prev_serp else None,
            )

            # Compare against this keyword's own first scan, which may be later
            # than the client's baseline if it was added to the tracked set.
            base_serp = _first_scan_for(keyword)
            if base_serp and base_serp.id == sr.id:
                base_serp = None

            serp_section.append({
                "keyword": keyword,
                "grid_data": attach_baseline_ranks(
                    grid_with_trends,
                    base_serp.grid_data if base_serp else None,
                ),
                # When the scan was actually taken, so the report can say so
                # rather than implying every figure is from this month.
                "scanned_at": sr.checked_at.isoformat() if sr.checked_at else None,
                "is_current": sr_key == period_key,
                "prev_scanned_at": (
                    prev_serp.checked_at.isoformat()
                    if prev_serp and prev_serp.checked_at else None
                ),
                "baseline_scanned_at": (
                    base_serp.checked_at.isoformat()
                    if base_serp and base_serp.checked_at else None
                ),
            })

        # ── Organic rankings (DataForSEO — disabled, replaced by GSC) ────────
        organic_section = []

        # ── GSC Search Analytics ──────────────────────────────────────────────
        gsc_section = {}
        try:
            gsc_section = get_search_analytics(config, month, year)
            # Search figures from the baseline month, for the since-inception
            # comparison. Skipped when the baseline is the month being reported.
            if gsc_section and baseline_year:
                base = get_site_totals_for_month(config, baseline_month, baseline_year)
                if base:
                    gsc_section["baseline_total_clicks"] = base["clicks"]
                    gsc_section["baseline_total_impressions"] = base["impressions"]
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
            # Which month everything is compared back to, so the report can name
            # it rather than saying "since inception" without evidence.
            "baseline": (
                {"year": baseline_year, "month": baseline_month}
                if baseline_year else None
            ),
        }

        # Upsert — replace existing report for same period if present
        p_month = label_month or month
        p_year = label_year or year

        existing = db.query(Report).filter(
            Report.client_id == client.id,
            Report.period_year == p_year,
            Report.period_month == p_month,
        ).first()

        now = datetime.now(timezone.utc)
        if existing:
            existing.data = data
            existing.generated_at = now
        else:
            db.add(Report(
                client_id=client.id,
                period_year=p_year,
                period_month=p_month,
                data=data,
                generated_at=now,
            ))

        db.commit()
        logger.info(
            f"[{config.client_id}] Report filed as {p_month}/{p_year}, covering {month}/{year}"
        )
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

        # Only scans actually taken in the period being recorded are stored.
        # Local Falcon returns its newest scan per keyword whether or not that
        # is recent, so a keyword that stopped being scanned used to have one
        # old result filed under every subsequent month and compared against
        # itself as "no change".
        stored, skipped = 0, []
        period_start = datetime(year, month, 1, tzinfo=timezone.utc)

        for scan in scans:
            if not scan["grid_data"]:
                continue
            scanned_at = parse_scan_date(scan.get("scan_date"))
            if scanned_at and scanned_at < period_start:
                skipped.append(f"{scan['keyword']} (last scanned {scanned_at:%Y-%m-%d})")
                continue
            _upsert_serp_result(
                db, client.id, scan["keyword"], scan["grid_data"], year, month, scanned_at,
            )
            stored += 1

        db.commit()
        logger.info(
            f"[{config.client_id}] Local Falcon SERP checks stored: "
            f"{stored} keyword(s) for {month}/{year}"
        )
        if skipped:
            logger.warning(
                f"[{config.client_id}] No scan this period for {len(skipped)} keyword(s): "
                + "; ".join(skipped)
            )
    except Exception as e:
        logger.error(f"[{config.client_id}] Local Falcon SERP storage failed: {e}")
        db.rollback()
    finally:
        db.close()


def parse_scan_date(raw: str | None) -> datetime | None:
    """Local Falcon's scan date, e.g. "11/10/2026 10:25 PM", as UTC."""
    if not raw:
        return None
    for fmt in ("%m/%d/%Y %I:%M %p", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    logger.warning(f"Local Falcon: unrecognised scan date {raw!r}")
    return None


def _upsert_serp_result(
    db, client_id: int, keyword: str, grid_data: list, year: int, month: int,
    scanned_at: datetime | None = None,
) -> None:
    """Insert or update a SerpResult row.

    checked_at records when the scan was actually taken, not when we read it.
    The two diverge whenever Local Falcon has no new scan for a keyword, and
    storing the read time made four-month-old data look current.
    """
    stamp = scanned_at or datetime.now(timezone.utc)
    existing = db.query(SerpResult).filter(
        SerpResult.client_id == client_id,
        SerpResult.keyword == keyword,
        SerpResult.period_year == year,
        SerpResult.period_month == month,
    ).first()

    if existing:
        existing.grid_data = grid_data
        existing.checked_at = stamp
    else:
        db.add(SerpResult(
            client_id=client_id,
            keyword=keyword,
            grid_data=grid_data,
            period_year=year,
            period_month=month,
            checked_at=stamp,
        ))
